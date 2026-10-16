import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../../open-sse/rtk/headroom.js";

afterEach(() => {
  vi.restoreAllMocks();
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
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: "long" }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://headroom:8787/", model: "gpt-4o" });

    expect(body.messages[0].content).toBe("short");
    expect(stats.tokens_saved).toBe(80);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/v1/compress", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      model: "gpt-4o",
      messages: [{ role: "user", content: "long" }],
    });
  });

  it("counts Claude system compression without counting unchanged tool schemas", async () => {
    const diagnostics = {};
    const body = {
      system: "long system prompt ".repeat(1000),
      messages: [{ role: "user", content: [{ type: "text", text: "unchanged message" }] }],
      tools: [{ name: "lookup", description: "tool schema ".repeat(10000), input_schema: { type: "object" } }],
    };
    const originalTools = structuredClone(body.tools);
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "system", content: "short system prompt" },
        { role: "user", content: "unchanged message" },
      ],
      tokens_before: 10000,
      tokens_after: 100,
      tokens_saved: 9900,
    }), { status: 200 }));

    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://localhost:8787", model: "claude-sonnet-4.5", format: "claude", diagnostics,
    });

    expect(body.tools).toEqual(originalTools);
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "unchanged message" }] }]);
    expect(body.system).toEqual(expect.arrayContaining([expect.objectContaining({ text: "short system prompt" })]));
    expect(isHeadroomPhantomSavings(stats, diagnostics)).toBe(false);
  });

  it.each([["absent", undefined], ["unchanged", "unchanged system ".repeat(1000)]])(
    "does not warn when Claude messages shrink and the system prompt is %s",
    async (_name, system) => {
      const diagnostics = {};
      const body = {
        system,
        messages: [{ role: "user", content: "x".repeat(1000) }],
      };
      global.fetch = vi.fn(async (_url, init) => {
        const { messages } = JSON.parse(init.body);
        return new Response(JSON.stringify({
          messages: messages.map((message) => message.role === "user"
            ? { ...message, content: "x".repeat(900) } : message),
          tokens_before: 1000,
          tokens_after: 900,
          tokens_saved: 100,
        }), { status: 200 });
      });

      const stats = await compressWithHeadroom(body, {
        enabled: true, url: "http://localhost:8787", model: "claude-sonnet-4.5", format: "claude", diagnostics,
      });

      expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "x".repeat(900) }] }]);
      expect(isHeadroomPhantomSavings(stats, diagnostics)).toBe(false);
    }
  );

  it("compresses responses input in-place", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
    }), { status: 200 }));
    const body = { input: [{ role: "user", content: "long" }] };

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
            content: "current user",
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
      config: { compress_user_messages: true },
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
        { role: "user", content: "current user" },
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
      messages: [{ role: "assistant", content: "wrong role" }],
      tokens_saved: 10,
    }), { status: 200 }));
    const body = {
      conversationState: {
        currentMessage: {
          userInputMessage: {
            content: "original",
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

describe("isHeadroomPhantomSavings", () => {
  it.each([
    ["healthy message compression with large tools", 1000, 500, false],
    ["barely smaller messages", 1000, 990, true],
    ["unchanged messages", 1000, 1000, true],
    ["larger messages", 1000, 1100, true],
    ["missing message sizes", undefined, undefined, false],
    ["empty original messages", 0, 10, false],
    ["missing compressed size", 1000, 0, false],
  ])("handles %s", (_name, before, after, expected) => {
    expect(isHeadroomPhantomSavings({ tokens_saved: 500 }, {
      before: { bodyBytes: 100000, messageBytes: before },
      after: { bodyBytes: 99500, messageBytes: after },
    })).toBe(expected);
  });

  it("does not warn without a positive reported token delta", () => {
    const diagnostics = {
      before: { bodyBytes: 100000, messageBytes: 1000 },
      after: { bodyBytes: 100000, messageBytes: 1000 },
    };
    for (const stats of [null, {}, { tokens_saved: 0 }, { tokens_saved: -1 }]) {
      expect(isHeadroomPhantomSavings(stats, diagnostics)).toBe(false);
    }
  });

  it("honors the requested message shrink threshold", () => {
    const diagnostics = {
      before: { bodyBytes: 100000, messageBytes: 1000 },
      after: { bodyBytes: 99900, messageBytes: 900 },
    };
    expect(isHeadroomPhantomSavings({ tokens_saved: 100 }, diagnostics)).toBe(false);
    expect(isHeadroomPhantomSavings({ tokens_saved: 100 }, diagnostics, 0.2)).toBe(true);
  });
});
