// Conversation cache breakpoints default to Anthropic's 5m TTL; the `claudeCacheTtl` setting can raise them to 1h so a pause longer than 5 minutes does not expire the conversation prefix. System/tools head anchors are always 1h.
import { describe, it, expect, vi, afterEach } from "vitest";
import { anchorClaudeCache, prepareClaudeRequest, normalizeClaudeCacheTtl } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const CC_5M = { type: "ephemeral" };
const CC_1H = { type: "ephemeral", ttl: "1h" };
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });
const tool = (name, extra = {}) => ({ name, description: "d", input_schema: { type: "object", properties: {} }, ...extra });
const use = (id) => ({ role: "assistant", content: [text("Reading."), { type: "tool_use", id, name: "read_file", input: { path: "a" } }] });
const result = (id, content = "file") => ({ type: "tool_result", tool_use_id: id, content });

function markers(body) {
  const out = {};
  (body.system || []).forEach((b, i) => b?.cache_control && (out[`system[${i}]`] = b.cache_control));
  (body.tools || []).forEach((t, i) => t?.cache_control && (out[`tools[${i}]`] = t.cache_control));
  (body.messages || []).forEach((m, i) => Array.isArray(m?.content) && m.content.forEach((b, j) => b?.cache_control && (out[`messages[${i}].${j}`] = b.cache_control)));
  return out;
}

const loop = () => ({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: [text("You are an agent.")],
  tools: [tool("read_file"), tool("run_command")],
  messages: [
    { role: "user", content: [text("Fix the bug.")] },
    use("t1"),
    { role: "user", content: [result("t1")] },
    use("t2"),
    { role: "user", content: [result("t2")] },
  ],
});

describe("normalizeClaudeCacheTtl", () => {
  it("accepts 1h and falls back to 5m for anything else", () => {
    expect(normalizeClaudeCacheTtl("1h")).toBe("1h");
    expect(normalizeClaudeCacheTtl("5m")).toBe("5m");
    expect(normalizeClaudeCacheTtl(undefined)).toBe("5m");
    expect(normalizeClaudeCacheTtl("24h")).toBe("5m");
  });
});

describe("prepareClaudeRequest: conversation cache TTL", () => {
  it("defaults conversation breakpoints to the bare 5m marker", () => {
    const out = prepareClaudeRequest(loop(), "claude");
    expect(markers(out)).toEqual({
      "system[0]": CC_1H,
      "tools[1]": CC_1H,
      "messages[3].1": CC_5M,
      "messages[4].0": CC_5M,
    });
  });

  it("uses 1h on every conversation breakpoint when configured", () => {
    const out = prepareClaudeRequest(loop(), "claude", null, null, null, null, { messageCacheTtl: "1h" });
    expect(markers(out)).toEqual({
      "system[0]": CC_1H,
      "tools[1]": CC_1H,
      "messages[3].1": CC_1H,
      "messages[4].0": CC_1H,
    });
  });

  it("ignores an unknown TTL value", () => {
    const out = prepareClaudeRequest(loop(), "claude", null, null, null, null, { messageCacheTtl: "forever" });
    expect(out.messages[3].content[1].cache_control).toEqual(CC_5M);
  });
});

describe("anchorClaudeCache: conversation cache TTL", () => {
  it("defaults to 5m", () => {
    const out = anchorClaudeCache(loop());
    expect(out.messages[3].content[1].cache_control).toEqual(CC_5M);
    expect(out.messages[4].content[0].cache_control).toEqual(CC_5M);
  });

  it("uses 1h when configured, and replaces the client's 5m markers", () => {
    const body = loop();
    body.messages[4].content[0].cache_control = { ...CC_5M };
    const out = anchorClaudeCache(body, { messageCacheTtl: "1h" });
    expect(markers(out)).toEqual({
      "system[0]": CC_1H,
      "tools[1]": CC_1H,
      "messages[3].1": CC_1H,
      "messages[4].0": CC_1H,
    });
  });

  it("anchors a first turn at 1h when configured", () => {
    const body = { model: "claude-sonnet-4-5", max_tokens: 1024, messages: [{ role: "user", content: [text("Hi")] }] };
    const out = anchorClaudeCache(body, { messageCacheTtl: "1h" });
    expect(out.messages[0].content[0].cache_control).toEqual(CC_1H);
  });

  it("raises a client's full budget of message markers to 1h, within 4", () => {
    const body = loop();
    body.messages.forEach((m) => m.content.forEach((b) => (b.cache_control = { ...CC_5M })));
    const out = anchorClaudeCache(body, { messageCacheTtl: "1h" });
    const all = Object.values(markers(out));
    expect(all.length).toBeLessThanOrEqual(4);
    expect(all.every((cc) => cc.ttl === "1h")).toBe(true);
  });

  it("leaves a client's full budget of message markers alone at 5m", () => {
    const body = loop();
    body.messages.forEach((m) => m.content.forEach((b) => (b.cache_control = { ...CC_5M })));
    const out = anchorClaudeCache(body);
    const msgMarkers = Object.entries(markers(out)).filter(([k]) => k.startsWith("messages"));
    expect(msgMarkers.length).toBeGreaterThan(0);
    expect(msgMarkers.every(([, cc]) => cc.ttl === undefined)).toBe(true);
  });
});

describe("translateRequest: claudeCacheTtl reaches the Claude target", () => {
  const openaiBody = () => ({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      { role: "system", content: "You are an agent." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello." },
      { role: "user", content: "Fix the bug." },
    ],
  });

  const lastAssistantMarker = (out) => {
    const assistant = out.messages.filter((m) => m.role === "assistant").at(-1);
    return assistant.content.find((b) => b.cache_control)?.cache_control;
  };

  it("defaults to 5m", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", openaiBody(), true, null, "claude");
    expect(lastAssistantMarker(out)).toEqual(CC_5M);
  });

  it("uses 1h when configured", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", openaiBody(), true, null, "claude", null, [], null, null, { claudeCacheTtl: "1h" });
    expect(lastAssistantMarker(out)).toEqual(CC_1H);
  });
});

describe("CLAUDE_CACHE_TTL env default", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("parses 1h case-insensitively and falls back to 5m", async () => {
    const { parseClaudeCacheTtl } = await import("../../open-sse/config/runtimeConfig.js");
    expect(parseClaudeCacheTtl("1h")).toBe("1h");
    expect(parseClaudeCacheTtl(" 1H ")).toBe("1h");
    expect(parseClaudeCacheTtl("5m")).toBe("5m");
    expect(parseClaudeCacheTtl(undefined)).toBe("5m");
    expect(parseClaudeCacheTtl("60m")).toBe("5m");
  });

  it("makes 1h the default when no setting is passed; an explicit 5m still wins", async () => {
    vi.stubEnv("CLAUDE_CACHE_TTL", "1h");
    vi.resetModules();
    const claude = await import("../../open-sse/translator/formats/claude.js");
    expect(claude.normalizeClaudeCacheTtl(undefined)).toBe("1h");
    expect(claude.normalizeClaudeCacheTtl("bogus")).toBe("1h");

    const out = claude.prepareClaudeRequest(loop(), "claude");
    expect(out.messages[3].content[1].cache_control).toEqual(CC_1H);
    expect(claude.anchorClaudeCache(loop()).messages[3].content[1].cache_control).toEqual(CC_1H);

    const explicit = claude.prepareClaudeRequest(loop(), "claude", null, null, null, null, { messageCacheTtl: "5m" });
    expect(explicit.messages[3].content[1].cache_control).toEqual(CC_5M);
  });

  it("seeds the dashboard setting default; a saved choice overrides it", async () => {
    vi.stubEnv("CLAUDE_CACHE_TTL", "1h");
    vi.resetModules();
    const { mergeWithDefaults } = await import("../../src/lib/db/repos/settingsRepo.js");
    expect(mergeWithDefaults({}).claudeCacheTtl).toBe("1h");
    expect(mergeWithDefaults({ claudeCacheTtl: "5m" }).claudeCacheTtl).toBe("5m");
  });
});
