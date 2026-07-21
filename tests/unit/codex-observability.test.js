import { describe, expect, it } from "vitest";
import { extractUsageFromResponse, formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { formatCodexDecisionLog } from "../../open-sse/utils/codexObservability.js";

describe("Codex redacted observability", () => {
  it("logs only bounded routing decisions", () => {
    const line = formatCodexDecisionLog({
      requestedModel: "gpt-5.6-sol-pro\nAuthorization: Bearer secret",
      upstreamModel: "gpt-5.6-sol",
      requestBody: {
        input: "PRIVATE PROMPT",
        authorization: "Bearer secret",
        reasoning_effort: "max",
      },
      upstreamBody: {
        model: "gpt-5.6-sol",
        input: "PRIVATE PROMPT",
        reasoning: { effort: "max", mode: "pro", summary: "auto" },
      },
      aliasMode: "pro",
      compact: true,
      status: 400,
      fallbackScope: "request",
    });

    expect(line).toContain("requested_mode=pro");
    expect(line).toContain("effective_mode=pro");
    expect(line).toContain("requested_effort=max");
    expect(line).toContain("effective_effort=max");
    expect(line).toContain("endpoint=compact");
    expect(line).toContain("status=400");
    expect(line).toContain("fallback_scope=request");
    expect(line).not.toContain("PRIVATE PROMPT");
    expect(line).not.toContain("Bearer secret");
    expect(line).not.toContain("\n");
  });

  it("extracts and reports Responses reasoning usage", () => {
    const usage = extractUsageFromResponse({
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens_details: { reasoning_tokens: 5 },
      },
    });
    expect(usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      cache_read_input_tokens: undefined,
      cache_creation_input_tokens: undefined,
      cached_tokens: 4,
      reasoning_tokens: 5,
    });
    expect(formatDoneLine({ usage, latency: { total: 91 } }))
      .toBe("DONE 91ms · IN 12 (CACHE ↻4) · OUT 8 · REASONING 5");
  });
});
