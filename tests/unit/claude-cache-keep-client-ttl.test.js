// Re-anchoring drops the client's cache markers. When the client asked for a 1h TTL on
// its message breakpoints (Claude Code does), the re-anchored tail must keep 1h: a 5m
// tail expires during any pause and the whole conversation is cache-written again.
import { describe, it, expect } from "vitest";
import { anchorClaudeCache, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const H1 = { type: "ephemeral", ttl: "1h" };
const M5 = { type: "ephemeral" };
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });
const tool = (name) => ({ name, description: "d", input_schema: { type: "object", properties: {} } });

const loop = (cc) => ({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: [text("You are an agent.", { cache_control: H1 })],
  tools: [tool("read_file")],
  messages: [
    { role: "user", content: [text("Fix the bug.")] },
    { role: "assistant", content: [text("Reading."), { type: "tool_use", id: "t1", name: "read_file", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file", ...(cc ? { cache_control: cc } : {}) }] },
  ],
});

const messageMarkers = (body) =>
  body.messages.flatMap((m) => m.content.filter((b) => b.cache_control).map((b) => b.cache_control));

describe.each([
  ["anchorClaudeCache (passthrough)", (b) => anchorClaudeCache(b)],
  ["prepareClaudeRequest (translated)", (b) => prepareClaudeRequest(b, "claude")],
])("%s", (_, run) => {
  it("keeps the client's 1h TTL on the message breakpoints", () => {
    const out = run(loop(H1));
    expect(messageMarkers(out)).toEqual([H1, H1]); // last assistant + final tool results
    expect(out.system.at(-1).cache_control).toEqual(H1);
  });

  it("keeps 5m when the client asked for 5m", () => {
    expect(messageMarkers(run(loop(M5)))).toEqual([M5, M5]);
  });

  it("defaults to 5m when the client sent no message markers", () => {
    expect(messageMarkers(run(loop(null)))).toEqual([M5, M5]);
  });
});

it("reads a 1h marker on a bare-object content block too", () => {
  const body = loop(null);
  body.messages[0].content = text("Fix the bug.", { cache_control: H1 });
  expect(messageMarkers(anchorClaudeCache(body))).toEqual([H1, H1]);
});

it("keeps the 1h TTL when the client's only message marker sits on a mid-conversation system turn", async () => {
  const { normalizeClaudePassthrough } = await import("../../open-sse/translator/formats/claude.js");
  const body = {
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: [text("You are an agent.", { cache_control: H1 })],
    messages: [
      { role: "user", content: [text("context"), text("Fix the bug.")] },
      { role: "system", content: [text("reminder", { cache_control: H1 })] },
    ],
  };
  normalizeClaudePassthrough(body, body.model);
  expect(messageMarkers(anchorClaudeCache(body))).toEqual([H1]);
});
