import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  executeMock: vi.fn(),
  headroom: {
    compressWithHeadroom: vi.fn(async () => null),
    formatHeadroomLog: vi.fn(() => null),
    formatHeadroomSizeLog: vi.fn(() => ""),
    isHeadroomPhantomSavings: vi.fn(() => false),
  },
  onPxpipeEvent: vi.fn(),
}));

function makeExecutorRes(content = "ok") {
  return {
    response: new Response(
      JSON.stringify({
        id: "chatcmpl-x",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop", index: 0 }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ),
    url: "https://api.openai.com/v1/chat/completions",
    headers: {},
    transformedBody: null,
  };
}

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.executeMock }),
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

vi.mock("../../open-sse/rtk/index.js", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    compressMessages: vi.fn((body, enabled) => {
      if (!enabled) return null;
      const big = "x".repeat(800);
      const small = "x".repeat(100);
      // mutate like real RTK: shrink one tool_result if present
      for (const m of (body.messages || [])) {
        if (m?.role === "tool" && typeof m.content === "string" && m.content.length > 500) {
          m.content = small;
        }
        if (Array.isArray(m?.content)) {
          for (const part of m.content) {
            if (part?.type === "tool_result" && typeof part.content === "string" && part.content.length > 500) {
              part.content = small;
            }
          }
        }
      }
      return { bytesBefore: big.length, bytesAfter: small.length, hits: [{ filter: "git_diff" }], filter: "git_diff" };
    }),
  };
});

vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: mocks.headroom.compressWithHeadroom,
  formatHeadroomLog: mocks.headroom.formatHeadroomLog,
  formatHeadroomSizeLog: mocks.headroom.formatHeadroomSizeLog,
  isHeadroomPhantomSavings: mocks.headroom.isHeadroomPhantomSavings,
}));

vi.mock("../../open-sse/pxpipe.js", () => ({
  compressWithPxpipe: vi.fn(async () => ({ body: null, summary: { applied: false, reason: "disabled" } })),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const tokenSaverEvents = vi.hoisted(() => ({
  appendTokenSaverEvent: vi.fn(),
}));

vi.mock("@/lib/tokenSaver/events.js", async () => {
  const actual = await vi.importActual("@/lib/tokenSaver/events.js").catch(() => ({}));
  return {
    ...actual,
    appendTokenSaverEvent: tokenSaverEvents.appendTokenSaverEvent,
    readTokenSaverEvents: vi.fn(() => []),
    getTokenSaverStats: vi.fn(() => ({ windows: {}, timeline: [], recent: [] })),
  };
});

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("chatCore tokenSaver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // fresh Response per call: a consumed ReadableStream cannot be reused
    mocks.executeMock.mockImplementation(async () => makeExecutorRes());
    globalThis.fetch = vi.fn(async () => {
      throw new Error("unexpected fetch");
    });
  });

  function baseArgs(overrides = {}) {
    return {
      body: {
        model: "openai/gpt-4o",
        stream: false,
        messages: [
          { role: "tool", tool_call_id: "x", content: "x".repeat(800) },
          { role: "user", content: "hi" },
        ],
      },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "sk-test", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn(), tagForSession: () => "TAG", nextTag: () => "TAG", fmtThink: () => null },
      connectionId: "conn-1",
      rtkEnabled: true,
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      pxpipeEnabled: false,
      clientRawRequest: { headers: {}, body: {} },
      onTokenSaverEvent: undefined,
      onPxpipeEvent: mocks.onPxpipeEvent,
      ...overrides,
    };
  }

  it("header off (case-insensitive) emits and persists zero events", async () => {
    const onTokenSaverEvent = vi.fn();
    for (const hdr of ["off", "Off", "OFF"]) {
      vi.clearAllMocks();
      await handleChatCore({
        ...baseArgs({ onTokenSaverEvent, clientRawRequest: { headers: { "x-9router-token-saver": hdr }, body: {} } }),
      });
      expect(onTokenSaverEvent).not.toHaveBeenCalled();
      expect(tokenSaverEvents.appendTokenSaverEvent).not.toHaveBeenCalled();
    }
  });

  it("emits at most once per request for RTK regardless of input shape", async () => {
    const onTokenSaverEvent = vi.fn();
    await handleChatCore(baseArgs({ onTokenSaverEvent }));
    const rtkCalls = onTokenSaverEvent.mock.calls.filter((c) => c[0]?.saver === "rtk");
    expect(rtkCalls.length).toBeLessThanOrEqual(1);
  });

  it("RTK event uses characters before/after/saved (no bytes fields)", async () => {
    const onTokenSaverEvent = vi.fn();
    await handleChatCore(baseArgs({ onTokenSaverEvent }));
    const rtk = onTokenSaverEvent.mock.calls.find((c) => c[0]?.saver === "rtk")?.[0];
    if (rtk) {
      expect("bytesBefore" in rtk).toBe(false);
      expect("bytesAfter" in rtk).toBe(false);
      expect(typeof rtk.charsBefore).toBe("number");
      expect(typeof rtk.charsAfter).toBe("number");
      expect(typeof rtk.charsSaved).toBe("number");
    }
  });

  it("Headroom event only after diagnostics.after exists and uses proxy-reported tokens", async () => {
    mocks.headroom.compressWithHeadroom.mockImplementation(async (body, { diagnostics }) => {
      diagnostics.before = { bodyBytes: 5000, messageBytes: 3000, toolSchemaBytes: 0, toolHistoryBytes: 1000 };
      // only diagnostics.after + returned stats qualifies
      diagnostics.after = { bodyBytes: 4000, messageBytes: 2200, toolSchemaBytes: 0, toolHistoryBytes: 800 };
      return { tokens_before: 1000, tokens_after: 600, tokens_saved: 400, messages: body.messages || body.input };
    });
    const onTokenSaverEvent = vi.fn();
    await handleChatCore(baseArgs({ onTokenSaverEvent }));
    const hr = onTokenSaverEvent.mock.calls.find((c) => c[0]?.saver === "headroom")?.[0];
    expect(hr).toBeDefined();
    expect(hr.tokensBefore).toBe(1000);
    expect(hr.tokensAfter).toBe(600);
    expect(hr.tokensSaved).toBe(400);
  });

  it("Headroom event NOT emitted when diagnostics.after missing", async () => {
    mocks.headroom.compressWithHeadroom.mockImplementation(async (body, { diagnostics }) => {
      diagnostics.before = { bodyBytes: 5000 };
      // deliberately omit diagnostics.after
      return { tokens_before: 1000, tokens_after: 600, tokens_saved: 400 };
    });
    const onTokenSaverEvent = vi.fn();
    await handleChatCore(baseArgs({ onTokenSaverEvent }));
    const hr = onTokenSaverEvent.mock.calls.filter((c) => c[0]?.saver === "headroom");
    expect(hr).toHaveLength(0);
  });

  it("callback failure never affects request — executor still runs", async () => {
    const boom = vi.fn(() => { throw new Error("boom"); });
    await handleChatCore(baseArgs({ onTokenSaverEvent: boom }));
    expect(mocks.executeMock).toHaveBeenCalled();
  });

  it("optional onTokenSaverEvent signature: omitting callback still succeeds", async () => {
    const res = await handleChatCore(baseArgs({ onTokenSaverEvent: undefined }));
    expect(res).toBeDefined();
    expect(mocks.executeMock).toHaveBeenCalled();
  });
});
