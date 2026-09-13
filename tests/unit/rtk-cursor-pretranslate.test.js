import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function makeLongDiff() {
  const lines = ["diff --git a/foo.js b/foo.js", "index abc..def 100644", "--- a/foo.js", "+++ b/foo.js", "@@ -1,3 +1,200 @@"];
  for (let i = 0; i < 200; i++) lines.push(`+added line ${i} UNIQUE_PADDING_${i} ${"x".repeat(20)}`);
  return lines.join("\n");
}

describe("token savers on Cursor (pre-translate RTK)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/v1/compress")) {
        const payload = JSON.parse(init.body);
        return new Response(JSON.stringify({
          messages: payload.messages,
          tokens_before: 8000,
          tokens_after: 2500,
          tokens_saved: 5500,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api2.cursor.sh/agent",
      headers: {},
      transformedBody: null,
    });
  });

  it("compresses role:tool git diffs before openai→cursor rewrite, then injects Headroom/Caveman/Ponytail", async () => {
    const diff = makeLongDiff();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn() };

    await handleChatCore({
      body: {
        model: "cu/default",
        stream: false,
        messages: [
          { role: "system", content: "hi" },
          { role: "user", content: "run git diff" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: JSON.stringify({ command: "git diff" }) } }],
          },
          { role: "tool", tool_call_id: "call_1", content: diff },
          { role: "user", content: "summarize" },
        ],
      },
      modelInfo: { provider: "cursor", model: "default" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "test-conn",
      rtkEnabled: true,
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      cavemanEnabled: true,
      cavemanLevel: "full",
      ponytailEnabled: true,
      ponytailLevel: "full",
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: { model: "cu/default" },
        headers: { accept: "application/json" },
      },
    });

    expect(executeMock).toHaveBeenCalled();
    const dispatched = executeMock.mock.calls[0][0].body;
    const blob = JSON.stringify(dispatched.messages);

    expect(dispatched.messages.some((m) => m.role === "tool")).toBe(false);
    expect(blob).toContain("<tool_result>");
    expect(blob).toContain("lines truncated");
    expect(blob).not.toContain("UNIQUE_PADDING_150");
    expect(blob).toContain("lazy senior developer");
    expect(blob).toMatch(/Respond like a caveman|drop filler|ACTIVE EVERY RESPONSE/i);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8787/v1/compress",
      expect.any(Object)
    );

    const xf = log.line.mock.calls.find((c) => c[1] === "⚙");
    expect(xf, "expected ⚙ saver log").toBeTruthy();
    expect(xf[2]).toContain("RTK:");
    expect(xf[2]).toContain("CAVEMAN:full");
    expect(xf[2]).toContain("PONYTAIL:full");
  });
});
