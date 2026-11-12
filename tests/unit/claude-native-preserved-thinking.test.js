import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../open-sse/config/defaultThinkingSignature.js";

const { executeMock, forcedSSEToJsonMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  forcedSSEToJsonMock: vi.fn(),
}));

// Run the real chatCore/native normalization path, stopping at the executor.
// No provider credentials or live upstream are needed for history preservation.
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/sseToJsonHandler.js", () => ({
  handleForcedSSEToJson: forcedSSEToJsonMock,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const model = "claude-opus-5-5";
// The existing E-form fixture passes the current signature validator. C-form
// validation is a separate issue; a rejected signature would hide the text bug.
const thinking = (text = "") => ({
  type: "thinking", thinking: text, signature: DEFAULT_THINKING_CLAUDE_SIGNATURE,
});
const redacted = () => ({ type: "redacted_thinking", data: "opaque-replayed-data" });
const toolUse = { type: "tool_use", id: "toolu_review", name: "Read", input: { path: "a.txt" } };
const requestWith = (blocks) => ({
  model, stream: false, max_tokens: 1024,
  thinking: { type: "adaptive", display: "updates" },
  messages: [
    { role: "user", content: "read a.txt" },
    { role: "assistant", content: blocks },
    { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "file contents" }] },
  ],
});

describe("first-party native Claude preserved thinking (#5184)", () => {
  it.each(["claude", "anthropic"])("%s keeps omitted thinking and progress updates in original order", (provider) => {
    const blocks = [thinking(""), thinking("checking the file"), toolUse];
    const out = normalizeClaudePassthrough(requestWith(structuredClone(blocks)), model, provider);
    expect(out.messages[1].content).toEqual(blocks);
  });

  it.each(["claude", "anthropic"])("%s preserves opaque redacted blocks without a signature field", (provider) => {
    const blocks = [redacted(), thinking(""), toolUse];
    const out = normalizeClaudePassthrough(requestWith(structuredClone(blocks)), model, provider);
    expect(out.messages[1].content).toEqual(blocks);
  });

  it("keeps an assistant turn containing only valid signed empty thinking", () => {
    const block = thinking();
    const body = requestWith([block]);
    body.messages[2] = { role: "user", content: "continue" };
    const out = normalizeClaudePassthrough(body, model, "claude");
    expect(out.messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out.messages[1].content).toEqual([block]);
  });

  it("does not rewrite whitespace inside a signed thinking block", () => {
    const block = thinking(" \n\t ");
    const out = normalizeClaudePassthrough(requestWith([block, toolUse]), model, "claude");
    expect(out.messages[1].content).toEqual([block, toolUse]);
  });

  it("still drops unsigned and foreign-signature thinking on first-party providers", () => {
    const out = normalizeClaudePassthrough(requestWith([
      { type: "thinking", thinking: "", signature: "not-a-Claude-signature" },
      { type: "thinking", thinking: "unsigned" }, toolUse,
    ]), model, "claude");
    expect(out.messages[1].content).toEqual([toolUse]);
  });

  it("still removes blank text blocks while preserving signed thinking", () => {
    const block = thinking();
    const out = normalizeClaudePassthrough(requestWith([
      { type: "text", text: " " }, block, toolUse,
    ]), model, "claude");
    expect(out.messages[1].content).toEqual([block, toolUse]);
  });

  it.each(["", "anthropic-compatible-test"])("does not relax legacy cleanup for provider %s", (provider) => {
    const out = normalizeClaudePassthrough(requestWith([
      redacted(), thinking(), toolUse,
    ]), model, provider);
    expect(out.messages[1].content).toEqual([toolUse]);
  });
});

describe("chatCore passes first-party provider identity to native normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response("", { status: 200 }),
      url: "https://upstream.invalid/messages", headers: {}, transformedBody: null,
    });
    forcedSSEToJsonMock.mockResolvedValue({ success: true, response: Response.json({}) });
  });

  async function outboundBody(provider) {
    const body = requestWith([redacted(), thinking(), thinking("checking"), toolUse]);
    await handleChatCore({
      body, modelInfo: { provider, model }, credentials: { providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "test-connection",
      rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false,
      ponytailEnabled: false, pxpipeEnabled: false, sourceFormatOverride: "claude",
      clientRawRequest: { endpoint: "/v1/messages", body,
        headers: { "user-agent": "claude-cli/2.1.295", "x-app": "cli" } },
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
    return executeMock.mock.calls[0][0].body;
  }

  it.each(["claude", "anthropic"])("%s forwards signed blank and redacted history to the executor", async provider => {
    const body = await outboundBody(provider);
    expect(body.messages[1].content.slice(0, 3)).toEqual([redacted(), thinking(), thinking("checking")]);
    expect(body.messages[1].content[3]).toMatchObject({ type: "tool_use", id: toolUse.id });
    expect(body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: toolUse.id });
  });

  it("compatible providers retain their existing blank/redacted cleanup", async () => {
    const body = await outboundBody("anthropic-compatible-test");
    expect(body.messages[1].content.map(b => b.type)).toEqual(["thinking", "tool_use"]);
    expect(body.messages[1].content[0]).toEqual(thinking("checking"));
  });
});
