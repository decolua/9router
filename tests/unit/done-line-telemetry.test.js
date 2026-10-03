import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { formatDoneLine } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
const { extractUsage, normalizeUsage, mergeUsage } = await import("../../open-sse/utils/usageTracking.js");

// The "📊 DONE" console line is the only per-request record that reaches log
// aggregation (Loki). These tests pin the extended contract: route identity
// (provider/model), metered kiro credits, and session id must appear so
// dashboards can aggregate cache-effectiveness and cost per model/job.
describe("formatDoneLine", () => {
  const usage = { prompt_tokens: 100, completion_tokens: 42 };
  const latency = { total: 2537, ttft: 2530 };

  it("keeps the legacy shape when no telemetry fields are provided", () => {
    expect(formatDoneLine({ usage, latency })).toBe(
      "DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42"
    );
  });

  it("appends provider/model, credits, and session id after the token stats", () => {
    const line = formatDoneLine({
      usage: { ...usage, kiro_credits: 0.21239843011608625 },
      latency,
      provider: "kiro",
      model: "claude-opus-4.8",
      sessionId: "ses_abc123",
    });
    expect(line).toBe(
      "DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · kiro/claude-opus-4.8 · 0.2124cr · sid:ses_abc123"
    );
  });

  it("keeps the cache breakdown intact when telemetry fields are appended", () => {
    const line = formatDoneLine({
      usage: {
        prompt_tokens: 3644,
        completion_tokens: 47,
        cache_read_input_tokens: 3328,
        cache_creation_input_tokens: 30,
      },
      latency: { total: 2365, ttft: 2343 },
      provider: "kiro",
      model: "gpt-5.6-luna",
    });
    expect(line).toBe(
      "DONE 2365ms · TTFT 2343ms · IN 3644 (CACHE ↻3328 +30) · OUT 47 · kiro/gpt-5.6-luna"
    );
  });

  it("prints the model alone when provider is missing", () => {
    const line = formatDoneLine({ usage, latency, model: "gpt-5.4" });
    expect(line).toBe("DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · gpt-5.4");
  });

  it("reports zero credits explicitly (free-tier metering is a real signal)", () => {
    const line = formatDoneLine({
      usage: { ...usage, kiro_credits: 0 },
      latency,
      provider: "kiro",
      model: "claude-opus-4.8",
    });
    expect(line).toBe(
      "DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · kiro/claude-opus-4.8 · 0cr"
    );
  });

  it("omits credits when kiro_credits is not a finite number", () => {
    const line = formatDoneLine({
      usage: { ...usage, kiro_credits: "n/a" },
      latency,
      provider: "kiro",
      model: "claude-opus-4.8",
    });
    expect(line).toBe("DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · kiro/claude-opus-4.8");
  });

  it("omits session id when blank and skips TTFT when absent", () => {
    const line = formatDoneLine({
      usage,
      latency: { total: 900 },
      provider: "codex",
      model: "gpt-5.4",
      sessionId: "",
    });
    expect(line).toBe("DONE 900ms · IN 100 · OUT 42 · codex/gpt-5.4");
  });
});

// kiro_credits must survive the stream-usage pipeline (extract → merge) or the
// done line can never show it: the kiro executor emits it on the final OpenAI-
// format chunk, and stream.js runs every chunk through extractUsage/mergeUsage.
describe("kiro_credits propagation through usage extraction", () => {
  it("extractUsage keeps kiro_credits from an OpenAI-format final chunk", () => {
    const usage = extractUsage({
      choices: [],
      usage: { prompt_tokens: 6066, completion_tokens: 2, kiro_credits: 0.2124 },
    });
    expect(usage).toMatchObject({ prompt_tokens: 6066, completion_tokens: 2, kiro_credits: 0.2124 });
  });

  it("normalizeUsage keeps kiro_credits and drops non-numeric values", () => {
    expect(normalizeUsage({ prompt_tokens: 10, kiro_credits: 0.1123 })).toMatchObject({ kiro_credits: 0.1123 });
    expect(normalizeUsage({ prompt_tokens: 10, kiro_credits: "credit" })).not.toHaveProperty("kiro_credits");
  });

  it("mergeUsage carries kiro_credits across chunk merges", () => {
    const merged = mergeUsage(
      { prompt_tokens: 6066, completion_tokens: 0 },
      { prompt_tokens: 6066, completion_tokens: 2, kiro_credits: 0.2124 }
    );
    expect(merged.kiro_credits).toBe(0.2124);
  });
});
