import { describe, it, expect, vi, afterEach } from "vitest";

const nativeFetch = global.fetch;
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog } from "../../open-sse/rtk/headroom.js";
import { parseHeadroomTimeoutMs } from "../../src/lib/headroom/detect.js";

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = nativeFetch;
  delete process.env.HEADROOM_API_KEY;
  delete process.env.HEADROOM_PROXY_TOKEN;
});

describe("parseHeadroomTimeoutMs", () => {
  const orig = process.env.HEADROOM_TIMEOUT_MS;
  afterEach(() => {
    if (orig === undefined) delete process.env.HEADROOM_TIMEOUT_MS;
    else process.env.HEADROOM_TIMEOUT_MS = orig;
  });

  it("defaults to 30000 on missing/invalid values", () => {
    delete process.env.HEADROOM_TIMEOUT_MS;
    expect(parseHeadroomTimeoutMs()).toBe(30000);
    process.env.HEADROOM_TIMEOUT_MS = "";
    expect(parseHeadroomTimeoutMs()).toBe(30000);
    process.env.HEADROOM_TIMEOUT_MS = "abc";
    expect(parseHeadroomTimeoutMs()).toBe(30000);
    process.env.HEADROOM_TIMEOUT_MS = "0";
    expect(parseHeadroomTimeoutMs()).toBe(30000);
    process.env.HEADROOM_TIMEOUT_MS = "-5";
    expect(parseHeadroomTimeoutMs()).toBe(30000);
    process.env.HEADROOM_TIMEOUT_MS = "1.5";
    expect(parseHeadroomTimeoutMs()).toBe(30000);
  });

  it("accepts finite integers in (0, 600000) and rejects the boundary", () => {
    process.env.HEADROOM_TIMEOUT_MS = "2000";
    expect(parseHeadroomTimeoutMs()).toBe(2000);
    process.env.HEADROOM_TIMEOUT_MS = "599999";
    expect(parseHeadroomTimeoutMs()).toBe(599999);
    process.env.HEADROOM_TIMEOUT_MS = "600000";
    expect(parseHeadroomTimeoutMs()).toBe(30000);
    process.env.HEADROOM_TIMEOUT_MS = "999999";
    expect(parseHeadroomTimeoutMs()).toBe(30000);
  });
});

describe("headroom outbound auth", () => {
  it("sends Bearer HEADROOM_API_KEY when set; never HEADROOM_PROXY_TOKEN; no secret in diagnostics", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "x" }],
    }), { status: 200 }));

    // API key only.
    process.env.HEADROOM_API_KEY = "  sk-key-only  ";
    delete process.env.HEADROOM_PROXY_TOKEN;
    const diagKey = {};
    await compressWithHeadroom({ messages: [{ role: "user", content: "hi" }] }, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diagKey,
    });
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-key-only"); // trimmed

    // Proxy token only → NO outbound Authorization (inbound server config only).
    delete process.env.HEADROOM_API_KEY;
    process.env.HEADROOM_PROXY_TOKEN = "tok-inbound-secret-value";
    const diagTok = {};
    await compressWithHeadroom({ messages: [{ role: "user", content: "hi" }] }, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diagTok,
    });
    expect(fetchSpy.mock.calls[1][1].headers.Authorization).toBeUndefined();

    // Both set → API key wins, proxy token never leaks.
    process.env.HEADROOM_API_KEY = "sk-both-set";
    const diagBoth = {};
    await compressWithHeadroom({ messages: [{ role: "user", content: "hi" }] }, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diagBoth,
    });
    expect(fetchSpy.mock.calls[2][1].headers.Authorization).toBe("Bearer sk-both-set");

    for (const diag of [diagKey, diagTok, diagBoth]) {
      const s = JSON.stringify(diag);
      expect(s).not.toContain("tok-inbound-secret-value");
      expect(s).not.toContain("sk-key-only");
      expect(s).not.toContain("sk-both-set");
    }
  });
});

describe("one-call + payload contract", () => {
  it("sends exactly one POST with model/messages/config.mode=lossy_inline and never frozen_message_count", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100, tokens_after: 10, tokens_saved: 90,
    }), { status: 200 }));

    const body = { messages: [{ role: "user", content: "long" }] };
    await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787/", model: "m", format: "openai",
      compressUserMessages: true, diagnostics: {},
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:8787/v1/compress");
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(payload.model).toBe("m");
    expect(payload.messages).toEqual([{ role: "user", content: "long" }]);
    expect(payload.config).toEqual({ mode: "lossy_inline", compress_user_messages: true });
    expect(JSON.stringify(payload)).not.toContain("frozen_message_count");
    // No fallback retry after success — one call total.
  });

  it("config omits compress_user_messages when disabled but keeps lossy_inline mode", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_saved: 5,
    }), { status: 200 }));
    await compressWithHeadroom({ messages: [{ role: "user", content: "long long long" }] }, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai",
      compressUserMessages: false, diagnostics: {},
    });
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(payload.config).toEqual({ mode: "lossy_inline" });
  });
});

describe("older proxy rejection is one-call fail-open", () => {
  it.each([400, 404])("HTTP %s → null, body untouched, no retry pivot", async (status) => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unknown field config.mode" }), { status })
    );
    const body = { messages: [{ role: "user", content: "original" }] };
    const before = JSON.stringify(body);
    const diag = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });

    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(diag.reason).toMatch(/HTTP|rejected/i);
  });
});

describe("compression_skipped contract", () => {
  it("200 with compression_skipped=true returns null and preserves body verbatim", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      compression_skipped: true,
      skip_reason: "context below compression floor",
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: "small context" }] };
    const before = JSON.stringify(body);
    const diag = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });

    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(diag.reason).toBe("context below compression floor");
  });

  it("bounds a remote-provided skip_reason so it cannot flood logs", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      compression_skipped: true,
      skip_reason: "x".repeat(100000),
    }), { status: 200 }));
    const diag = {};
    await compressWithHeadroom({ messages: [{ role: "user", content: "hi" }] }, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });
    expect((diag.reason || "").length).toBeLessThanOrEqual(200);
  });

  it("missing messages in a 200 response is invalid → null", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ tokens_saved: 3 }), { status: 200 }));
    const body = { messages: [{ role: "user", content: "keep me" }] };
    const before = JSON.stringify(body);
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
  });
});

describe("CCR marker rejection", () => {
  it.each([
    ["ccr_hashes nonempty", { ccr_hashes: ["deadbeef"], messages: [{ role: "user", content: "clean text" }] }],
    ["<<ccr: prefix inside content", { messages: [{ role: "user", content: "before <<ccr:abc123>> after" }] }],
    ["<<ccr: prefix inside block part", { messages: [{ role: "assistant", content: [{ type: "text", text: "<<ccr:xyz>>" }] }] }],
    ["<<ccr: prefix inside tool_calls function arguments", { messages: [{ role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{\"x\":\"<<ccr:hidden>>\"}" } }] }] }],
    ["<<ccr: prefix inside non-text tool-result part", { messages: [{ role: "tool", tool_call_id: "c1", content: [{ type: "image_url", image_url: { url: "data:text/plain,<<ccr:nested>>" } }] }] }],
  ])("rejects %s without touching body", async (_label, responseData) => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(responseData), { status: 200 }));
    const body = { messages: [{ role: "user", content: "original untouched content here now" }] };
    const before = JSON.stringify(body);
    const diag = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });

    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(diag.reason).toMatch(/CCR/i);
  });

  it("does not reject on unrelated metadata mentioning ccr outside message content", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "compressed fine" }],
      tokens_before: 100, tokens_after: 10, tokens_saved: 90,
      debug_note: "ccr engine v2", // unrelated metadata — not message content
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: "long original content" }] };
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(stats).not.toBeNull();
    expect(body.messages[0].content).toBe("compressed fine");
  });
});

describe("error tool result skip (pre-fetch)", () => {
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "should never be used" }],
      tokens_saved: 50,
    }), { status: 200 }));
  });

  it("Claude tool_result is_error:true skips before fetch", async () => {
    const body = {
      system: "sys", tools: [],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "f", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true }] },
      ],
    };
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "claude", diagnostics: diag,
    });
    expect(stats).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(diag.reason).toMatch(/error tool/i);
  });

  it("Kiro toolResults status:error skips before fetch", async () => {
    const body = {
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: "hi", modelId: "claude",
            userInputMessageContext: { toolResults: [{ toolUseId: "t", status: "error", content: [{ text: "failed" }] }] },
          },
        },
      },
    };
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "kiro", diagnostics: diag,
    });
    expect(stats).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Responses function_call_output status error or is_error skips before fetch", async () => {
    for (const extra of [{ status: "error" }, { is_error: true }]) {
      fetchSpy.mockClear();
      const input = [
        { type: "message", role: "user", content: [{ type: "input_text", text: "q" }] },
        { type: "function_call_output", call_id: "c1", output: "Error: nope", ...extra },
      ];
      const body = { input };
      const diag = {};
      const stats = await compressWithHeadroom(body, {
        enabled: true, url: "http://localhost:8787", model: "m", format: "openai-responses", diagnostics: diag,
      });
      expect(stats).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it("OpenAI explicit error shapes skip; plain text never triggers inference", async () => {
    // Explicit flag on tool message → skip.
    const errBody = { messages: [{ role: "tool", tool_call_id: "t", content: "boom", is_error: true }] };
    const d1 = {};
    expect(await compressWithHeadroom(errBody, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: d1,
    })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Content merely SAYS "error" → must NOT skip.
    const textOnly = { messages: [{ role: "tool", tool_call_id: "t", content: "the word error appears but flag absent" }] };
    fetchSpy.mockClear();
    await compressWithHeadroom(textOnly, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Claude direct path (no OpenAI pivot)", () => {
  it("sends Claude messages directly; preserves system and tools byte-for-byte locally", async () => {
    const tools = [{ name: "read_file", input_schema: { type: "object" } }];
    const system = [{ type: "text", text: "be terse" }];
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "compressed ok" }] },
      ],
      tokens_before: 500, tokens_after: 100, tokens_saved: 400,
    }), { status: 200 }));

    const body = {
      system,
      tools,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "very long original output ".repeat(20) }] },
      ],
    };
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "claude-x", format: "claude", diagnostics: diag,
    });

    expect(stats).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // Direct Claude payload: messages only — system/tools stay local, not sent.
    expect(payload.system).toBeUndefined();
    expect(payload.tools).toBeUndefined();
    // Roles preserved in order.
    expect(payload.messages.map((mm) => mm.role)).toEqual(["assistant", "user"]);
    // Local body keeps system/tools untouched byte-for-byte semantics.
    expect(body.system).toEqual(system);
    expect(body.tools).toEqual(tools);
    // Messages replaced in place.
    expect(body.messages[1].content[0].content).toBe("compressed ok");
  });

  it("response count/role/content-shape mismatch → null, body unchanged, one call", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "system", content: "mutated role" }],
      tokens_saved: 99,
    }), { status: 200 }));
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "f", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "data " }] },
      ],
    };
    const before = JSON.stringify(body);
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "claude", diagnostics: diag,
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(diag.reason).toMatch(/shape|count|role/i);
  });

  it("older proxy 404 on Claude direct fails open after one call, no pivot retry", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 404 })
    );
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "hello there friend" }] }] };
    const before = JSON.stringify(body);
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "claude", diagnostics: {},
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no second attempt via OpenAI pivot
  });
});

describe("no-gain / phantom / conflicting metrics guard", () => {
  const bigOriginal = "meaningful original content that is fairly long here ".repeat(30);

  it("zero reported token gain keeps original body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: bigOriginal.slice(0, 50) }],
      tokens_before: 100, tokens_after: 100, tokens_saved: 0,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const before = JSON.stringify(body);
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
  });

  it("phantom gain (tokens shrink claimed, bytes grow) keeps original body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: bigOriginal + " EXTRA PADDING THAT GROWS PAYLOAD".repeat(10) }],
      tokens_before: 1000, tokens_after: 5, tokens_saved: 995,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const before = JSON.stringify(body);
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(diag.reason).toMatch(/gain|shrink|phantom|size/i);
  });

  it("conflicting metrics (after > before) keep original body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "shorter!" }],
      tokens_before: 50, tokens_after: 80, tokens_saved: -30,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const before = JSON.stringify(body);
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
  });

  it("real gain commits replacement", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "tiny" }],
      tokens_before: 900, tokens_after: 3, tokens_saved: 897,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(stats).not.toBeNull();
    expect(body.messages[0].content).toBe("tiny");
  });

  it("exception thrown by proxy leaves original body unchanged", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const before = JSON.stringify(body);
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
  });
});

describe("string-number token metric gates", () => {
  const bigOriginal = "meaningful original content that is fairly long here ".repeat(30);

  function proxyResponse(extra) {
    return new Response(JSON.stringify({
      messages: [{ role: "user", content: bigOriginal.slice(0, 40) }],
      ...extra,
    }), { status: 200 });
  }

  it("string tokens_saved:'0' still trips the no-gain gate", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(proxyResponse({ tokens_saved: "0" }));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const before = JSON.stringify(body);
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(diag.reason).toMatch(/no token saving/i);
  });

  it("string tokens_before/after still trip the phantom-savings gate", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(proxyResponse({
      tokens_before: "1000", tokens_after: "990", tokens_saved: "10",
    }));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const before = JSON.stringify(body);
    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });
    expect(stats).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    expect(diag.reason).toMatch(/phantom/i);
  });

  it("valid string-encoded metrics with real gains still commit", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ role: "user", content: "tiny" }],
      tokens_before: "900", tokens_after: "3", tokens_saved: "897",
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: bigOriginal }] };
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(stats).not.toBeNull();
    expect(body.messages[0].content).toBe("tiny");
  });
});

describe("compressWithHeadroom", () => {
  it("no-ops when disabled", async () => {
    global.fetch = vi.fn();
    const body = { messages: [{ role: "user", content: "hello" }] };

    const stats = await compressWithHeadroom(body, { enabled: false, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.messages[0].content).toBe("hello");
  });

  it("compresses messages in-place", async () => {
    const longContent = "very verbose original context ".repeat(30);
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: longContent }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://headroom:8787/", model: "gpt-4o" });

    expect(body.messages[0].content).toBe("short");
    expect(stats.tokens_saved).toBe(80);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/v1/compress", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      model: "gpt-4o",
      messages: [{ role: "user", content: longContent }],
    });
  });

  it("compresses responses input in-place", async () => {
    const longText = "a".repeat(500);
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100, tokens_after: 2, tokens_saved: 98,
    }), { status: 200 }));
    const body = { input: [{ role: "user", content: longText }] };

    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(body.input[0].content).toBe("short");
  });

  it("compresses Kiro conversationState history/currentMessage in-place", async () => {
    let requestPayload;
    global.fetch = vi.fn(async (_url, init) => {
      requestPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        messages: [
          { role: "user", content: "compressed earlier user" },
          { role: "assistant", content: "compressed assistant", tool_calls: [{ id: "tool_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.js\"}" } }] },
          { role: "system", content: "compressed system instruction" },
          { role: "user", content: "compressed current user" },
          { role: "tool", content: [{ type: "text", text: "compressed tool output" }], tool_call_id: "tool_1" },
        ],
        tokens_before: 100,
        tokens_after: 40,
        tokens_saved: 60,
      }), { status: 200 });
    });
    const body = {
      profileArn: "arn:test",
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: "conv-1",
        history: [
          {
            userInputMessage: {
              content: "earlier user",
              modelId: "claude-sonnet-4.5",
            },
          },
          {
            assistantResponseMessage: {
              content: "assistant response",
              toolUses: [
                {
                  toolUseId: "tool_1",
                  name: "read_file",
                  input: { path: "a.js" },
                },
              ],
            },
          },
        ],
        currentMessage: {
          userInputMessage: {
            content: "current user".concat(" with padding ".repeat(60)),
            modelId: "claude-sonnet-4.5",
            systemInstruction: "native system instruction",
            userInputMessageContext: {
              tools: [{ toolSpecification: { name: "read_file" } }],
              toolResults: [
                {
                  toolUseId: "tool_1",
                  status: "success",
                  content: [{ text: "long tool output" }],
                },
              ],
            },
          },
        },
      },
    };

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      compressUserMessages: true,
    });

    expect(stats.tokens_saved).toBe(60);
    expect(requestPayload).toEqual({
      model: "claude-sonnet-4.5",
      config: { mode: "lossy_inline", compress_user_messages: true },
      messages: [
        { role: "user", content: "earlier user" },
        {
          role: "assistant",
          content: "assistant response",
          tool_calls: [
            {
              id: "tool_1",
              type: "function",
              function: { name: "read_file", arguments: "{\"path\":\"a.js\"}" },
            },
          ],
        },
        { role: "system", content: "native system instruction" },
        { role: "user", content: "current user".concat(" with padding ".repeat(60)) },
        { role: "tool", content: "long tool output", tool_call_id: "tool_1" },
      ],
    });
    expect(body.conversationState.history[0].userInputMessage.content).toBe("compressed earlier user");
    expect(body.conversationState.history[1].assistantResponseMessage.content).toBe("compressed assistant");
    expect(body.conversationState.currentMessage.userInputMessage.systemInstruction).toBe("compressed system instruction");
    expect(body.conversationState.currentMessage.userInputMessage.content).toBe("compressed current user");
    expect(body.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text)
      .toBe("compressed tool output");
    expect(body.profileArn).toBe("arn:test");
    expect(body.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools)
      .toEqual([{ toolSpecification: { name: "read_file" } }]);
  });

  it("fails open when Kiro Headroom output does not preserve message order", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "assistant", content: "x".repeat(200) }],
      tokens_before: 1000, tokens_after: 10, tokens_saved: 990,
    }), { status: 200 }));
    const body = {
      conversationState: {
        currentMessage: {
          userInputMessage: {
            content: "original payload with enough bytes to make byte-shrink guard pass ".repeat(10),
            modelId: "claude-sonnet-4.5",
          },
        },
        history: [],
      },
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      diagnostics,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("proxy response did not preserve Kiro message order");
  });

  it("fails open on bad response", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 }));
    const body = { messages: [{ role: "user", content: "long" }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(body.messages[0].content).toBe("long");
  });

  it("skips unknown shapes", async () => {
    global.fetch = vi.fn();
    const body = { contents: [{ parts: [{ text: "long" }] }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe("timeout normalization", () => {
    const mockResponse = JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    });

    function makeSuccessfulFetch() {
      global.fetch = vi.fn(async () =>
        new Response(mockResponse, { status: 200 })
      );
    }

    function captureTimeoutCalls() {
      const calls = [];
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        calls.push(ms);
        const controller = new AbortController();
        return controller.signal;
      });
      return calls;
    }

    it("passes a valid positive timeout to AbortSignal.timeout", async () => {
      makeSuccessfulFetch();
      const calls = captureTimeoutCalls();
      const body = { messages: [{ role: "user", content: "hello" }] };

      await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", timeoutMs: 5000 });

      expect(calls).toContain(5000);
    });

    it("falls back to the default timeout when timeoutMs is null", async () => {
      makeSuccessfulFetch();
      const calls = captureTimeoutCalls();
      const body = { messages: [{ role: "user", content: "hello" }] };

      await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", timeoutMs: null });

      expect(calls).toContain(3000);
    });

    it("falls back to the default timeout when timeoutMs is 0", async () => {
      makeSuccessfulFetch();
      const calls = captureTimeoutCalls();
      const body = { messages: [{ role: "user", content: "hello" }] };

      await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", timeoutMs: 0 });

      expect(calls).toContain(3000);
    });

    it("falls back to the default timeout when timeoutMs is negative", async () => {
      makeSuccessfulFetch();
      const calls = captureTimeoutCalls();
      const body = { messages: [{ role: "user", content: "hello" }] };

      await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", timeoutMs: -100 });

      expect(calls).toContain(3000);
    });

    it("falls back to the default timeout when timeoutMs is NaN", async () => {
      makeSuccessfulFetch();
      const calls = captureTimeoutCalls();
      const body = { messages: [{ role: "user", content: "hello" }] };

      await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", timeoutMs: NaN });

      expect(calls).toContain(3000);
    });

    it("falls back to the default timeout when timeoutMs is Infinity", async () => {
      makeSuccessfulFetch();
      const calls = captureTimeoutCalls();
      const body = { messages: [{ role: "user", content: "hello" }] };

      await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", timeoutMs: Infinity });

      expect(calls).toContain(3000);
    });

    it("falls back to the default timeout when timeoutMs is a string", async () => {
      makeSuccessfulFetch();
      const calls = captureTimeoutCalls();
      const body = { messages: [{ role: "user", content: "hello" }] };

      await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787", timeoutMs: "5000" });

      expect(calls).toContain(3000);
    });
  });
});

describe("OpenAI structural validation (adversarial proxy)", () => {
  const long = "meaningful original content that is fairly long here ".repeat(30);

  function threeMessageBody() {
    return {
      messages: [
        { role: "system", content: "system prompt ".repeat(20) },
        { role: "user", content: long },
        { role: "assistant", content: long },
      ],
    };
  }

  function proxyReply(messages) {
    return new Response(JSON.stringify({
      messages,
      tokens_before: 5000, tokens_after: 10, tokens_saved: 4990,
    }), { status: 200 });
  }

  it("dropped messages (3→1) with claimed savings → null, body untouched, one fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(proxyReply([
      { role: "user", content: "tiny" },
    ]));
    const body = threeMessageBody();
    const before = structuredClone(body);
    const diag = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(before);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(diag.reason).toMatch(/shape|order|count/i);
  });

  it("reordered roles (same count) → null, body untouched", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(proxyReply([
      { role: "system", content: "system prompt ".repeat(20) },
      { role: "assistant", content: "swapped" },
      { role: "user", content: "swapped" },
    ]));
    const body = threeMessageBody();
    const before = structuredClone(body);
    const diag = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(before);
    expect(diag.reason).toMatch(/shape|order|count/i);
  });

  it("invalid content shape (null content replacing text) → null, body untouched", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(proxyReply([
      { role: "system", content: "sys" },
      { role: "user", content: null },
      { role: "assistant", content: "kept" },
    ]));
    const body = threeMessageBody();
    const before = structuredClone(body);
    const diag = {};

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(before);
    expect(diag.reason).toMatch(/shape|order|count/i);
  });

  it("valid same-shape compression with real shrink still commits (not blanket reject)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(proxyReply([
      { role: "system", content: "sys" },
      { role: "user", content: "compressed q" },
      { role: "assistant", content: "compressed a" },
    ]));
    const body = threeMessageBody();

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });

    expect(stats).not.toBeNull();
    expect(body.messages.map((m) => m.content)).toEqual(["sys", "compressed q", "compressed a"]);
  });

  it("tool_call_id mutated → null; faithful tool_call_id commits", async () => {
    const toolCall = { id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"p\":\"a\"}" } };
    const body = {
      messages: [
        { role: "user", content: long },
        { role: "assistant", content: null, tool_calls: [toolCall] },
        { role: "tool", tool_call_id: "call_1", content: long },
      ],
    };

    // Mutated id → reject.
    vi.spyOn(global, "fetch").mockResolvedValueOnce(proxyReply([
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", tool_call_id: "call_HIJACKED", content: "short result" },
    ]));
    const diagMutated = {};
    expect(await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diagMutated,
    })).toBeNull();
    expect(body.messages[2].tool_call_id).toBe("call_1");
    expect(diagMutated.reason).toMatch(/shape|order|count|identity|pairing/i);

    // Faithful ids + shrunk text → commit.
    vi.spyOn(global, "fetch").mockResolvedValueOnce(proxyReply([
      { role: "user", content: "compressed q" },
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", tool_call_id: "call_1", content: "compressed result" },
    ]));
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: {},
    });
    expect(stats).not.toBeNull();
    expect(body.messages[2].tool_call_id).toBe("call_1");
    expect(body.messages[2].content).toBe("compressed result");
  });

  it("assistant tool_calls (ids/names/arguments) mutated → null, body untouched", async () => {
    const body = {
      messages: [
        { role: "assistant", content: long, tool_calls: [{ id: "call_9", type: "function", function: { name: "write_file", arguments: "{\"p\":\"x\"}" } }] },
        { role: "tool", tool_call_id: "call_9", content: long },
      ],
    };
    const before = structuredClone(body);
    vi.spyOn(global, "fetch").mockResolvedValue(proxyReply([
      { role: "assistant", content: "shrunk", tool_calls: [{ id: "call_9", type: "function", function: { name: "write_file", arguments: "{\"p\":\"EVIL\"}" } }] },
      { role: "tool", tool_call_id: "call_9", content: "shrunk" },
    ]));

    const diag = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "openai", diagnostics: diag,
    });

    expect(stats).toBeNull();
    expect(body).toEqual(before);
    expect(diag.reason).toMatch(/shape|order|count|identity|pairing/i);
  });

  it("generic body.input through default branch enforces same contract", async () => {
    // Dropped item (2→1) → reject.
    vi.spyOn(global, "fetch").mockResolvedValueOnce(proxyReply([
      { role: "user", content: "tiny" },
    ]));
    const body = {
      input: [
        { role: "user", content: long },
        { role: "assistant", content: long },
      ],
    };
    const before = structuredClone(body);
    const diag = {};
    expect(await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "unknown-generic", diagnostics: diag,
    })).toBeNull();
    expect(body).toEqual(before);
    expect(diag.reason).toMatch(/shape|order|count/i);

    // Valid shrink → commit.
    vi.spyOn(global, "fetch").mockResolvedValueOnce(proxyReply([
      { role: "user", content: "c" },
      { role: "assistant", content: "c" },
    ]));
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "m", format: "unknown-generic", diagnostics: {},
    });
    expect(stats).not.toBeNull();
    expect(body.input.map((i) => i.content)).toEqual(["c", "c"]);
  });
});

describe("formatHeadroomLog", () => {
  it("formats reported token deltas without implying provider billing savings", () => {
    expect(formatHeadroomLog({ tokens_before: 100, tokens_after: 25, tokens_saved: 75 }))
      .toBe("reported token delta=75 before=100 after=25 (75.0%)");
  });

  it("reports effective payload, tool-schema, and tool-history sizes", () => {
    expect(formatHeadroomSizeLog({
      before: { bodyBytes: 1000, messageBytes: 800, toolSchemaBytes: 100, toolHistoryBytes: 500 },
      after: { bodyBytes: 900, messageBytes: 700, toolSchemaBytes: 100, toolHistoryBytes: 400 },
    })).toContain("tools=100B→100B toolHistory=500B→400B effective=10.0%");
  });
});
