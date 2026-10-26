// #1998 — Headroom compression treated a Codex (openai-responses) body.input
// array as OpenAI messages: it sent Responses items to /v1/compress and then
// assigned the returned OpenAI messages back to body.input, violating the
// Responses format contract. body.input must stay Responses-shaped.
import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

const LONG_OUTPUT = "search result: file.js matches the requested symbol ".repeat(40);

function responsesHistory(output) {
  return [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "investigate bug" }],
    },
    {
      type: "function_call",
      call_id: "call_apply_patch_123",
      name: "apply_patch",
      arguments: "*** Begin Patch *** End Patch",
    },
    {
      type: "function_call_output",
      call_id: "call_apply_patch_123",
      output,
    },
    {
      type: "reasoning",
      id: "rs_headroom_1",
      summary: [{ type: "summary_text", text: "Need a plan" }],
      encrypted_content: "encrypted-reasoning-dummy",
    },
  ];
}

describe("compressWithHeadroom openai-responses format (#1998)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps body.input in Responses format after compressing an openai-responses request", async () => {
    // Headroom always returns compressed OpenAI-style messages.
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "user", content: "compressed text" }],
        tokens_before: 100,
        tokens_after: 90,
        tokens_saved: 10,
      }),
    }));

    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "a long original message ".repeat(20) }],
        },
      ],
    };

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
    });

    expect(data).not.toBeNull();
    // body.input must remain Responses items (type:"message" + content array),
    // NOT the raw OpenAI messages ({ role, content: "<string>" }) the bug produced.
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.input[0]).toMatchObject({ type: "message", role: "user" });
    expect(Array.isArray(body.input[0].content)).toBe(true);
    expect(typeof body.input[0].content).not.toBe("string");
  });

  it("rejects a proxy response that changes the projected tool role without mutating Responses history (#2132)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "user", content: "compressed tool history" }],
        tokens_saved: 10,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const input = responsesHistory("ok");
    const body = {
      input: structuredClone(input),
      tools: [
        {
          type: "custom",
          name: "apply_patch",
          format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
        },
      ],
    };
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("http://headroom.test/v1/compress");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      messages: [{ role: "tool", tool_call_id: "headroom-tool-0", content: "ok" }],
      model: "gpt-5",
    });
    expect(body.input).toEqual(input);
    expect(diagnostics.reason).toBe("proxy response did not preserve tool-output IDs, order, roles or text");
  });

  it("rejects a proxy response that changes projected tool-output identity", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "tool", tool_call_id: "headroom-tool-999", content: "ok" }],
        tokens_saved: 10,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const input = responsesHistory("ok");
    const body = { input: structuredClone(input) };
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual([
      { role: "tool", tool_call_id: "headroom-tool-0", content: "ok" },
    ]);
    expect(body.input).toEqual(input);
    expect(diagnostics.reason).toBe("proxy response did not preserve tool-output IDs, order, roles or text");
  });

  it("rewrites only the projected function_call_output text when the proxy returns shorter plain text", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "tool", tool_call_id: "headroom-tool-0", content: "short result" }],
        tokens_before: 2000,
        tokens_after: 20,
        tokens_saved: 1980,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const input = responsesHistory(LONG_OUTPUT);
    const body = {
      input: structuredClone(input),
      tools: [
        {
          type: "custom",
          name: "apply_patch",
          format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
        },
      ],
    };
    const originalTools = structuredClone(body.tools);

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
    });

    expect(data?.tokens_saved).toBe(1980);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toEqual({
      messages: [{ role: "tool", tool_call_id: "headroom-tool-0", content: LONG_OUTPUT }],
      model: "gpt-5",
    });
    const sent = JSON.stringify(payload.messages);
    expect(sent).not.toContain("*** Begin Patch");
    expect(sent).not.toContain("Need a plan");
    expect(sent).not.toContain("encrypted-reasoning-dummy");
    expect(sent).not.toContain("investigate bug");

    expect(body.input[0]).toEqual(input[0]);
    expect(body.input[1]).toEqual(input[1]);
    expect(body.input[2]).toEqual({ ...input[2], output: "short result" });
    expect(body.input[3]).toEqual(input[3]);
    expect(body.tools).toEqual(originalTools);
  });

  it("skips Responses history whose tool outputs are not plain text", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const input = [
      {
        type: "function_call_output",
        call_id: "call_json",
        output: '{"content":"structured data"}',
      },
      {
        type: "function_call_output",
        call_id: "call_image",
        output: [{ type: "input_image", image_url: "data:image/png;base64,dummy" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "investigate bug" }],
      },
    ];
    const body = { input: structuredClone(input) };
    const original = structuredClone(body);
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: "gpt-5",
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("no eligible plain-text tool output");
  });
});
