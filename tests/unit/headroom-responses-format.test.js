// #1998 — Headroom compression treated a Codex (openai-responses) body.input
// array as OpenAI messages: it sent Responses items to /v1/compress and then
// assigned the returned OpenAI messages back to body.input, violating the
// Responses format contract. body.input must stay Responses-shaped.
import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

const TEST_MODEL = "test-model";

describe("compressWithHeadroom openai-responses format (#1998)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps body.input in Responses format after compressing an openai-responses request", async () => {
    // Headroom always returns compressed OpenAI-style messages.
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [
          { role: "system", content: "Keep this instruction" },
          { role: "user", content: "compressed text" },
        ],
        tokens_before: 100,
        tokens_after: 90,
        tokens_saved: 10,
      }),
    }));

    const body = {
      instructions: "Keep this instruction",
      store: false,
      include: ["reasoning.encrypted_content"],
      input: [
        {
          id: "msg_original",
          type: "message",
          role: "user",
          status: "completed",
          content: [{ type: "input_text", text: "a long original message ".repeat(20) }],
        },
      ],
    };
    const originalEnvelope = {
      store: body.store,
      include: body.include,
      item: { ...body.input[0], content: undefined },
    };

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: TEST_MODEL,
      format: "openai-responses",
    });

    expect(data).not.toBeNull();
    // body.input must remain Responses items (type:"message" + content array),
    // NOT the raw OpenAI messages ({ role, content: "<string>" }) the bug produced.
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.input[0]).toMatchObject({
      id: "msg_original",
      type: "message",
      role: "user",
      status: "completed",
    });
    expect(Array.isArray(body.input[0].content)).toBe(true);
    expect(body.input[0].content).toEqual([{ type: "input_text", text: "compressed text" }]);
    expect(body.instructions).toBe("Keep this instruction");
    expect(body.store).toBe(originalEnvelope.store);
    expect(body.include).toEqual(originalEnvelope.include);
    expect({ ...body.input[0], content: undefined }).toEqual(originalEnvelope.item);
  });

  it("fails open when Headroom changes Responses message order", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "assistant", content: "wrong role" }],
        tokens_saved: 10,
      }),
    }));

    const body = {
      input: [{
        id: "msg_original",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "original text" }],
      }],
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: TEST_MODEL,
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("proxy response did not preserve Responses message order");
  });

  it("fails open when Headroom changes the Responses message count", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "user", content: "only one message" }],
        tokens_saved: 10,
      }),
    }));

    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] },
        { type: "message", role: "assistant", content: [{ type: "input_text", text: "second" }] },
      ],
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: TEST_MODEL,
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("proxy response did not preserve Responses message count");
  });

  it("skips multipart Responses messages instead of rebuilding their content", async () => {
    global.fetch = vi.fn();
    const body = {
      input: [{
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "describe this" },
          { type: "input_image", image_url: "https://example.com/image.png" },
        ],
      }],
    };
    const original = structuredClone(body);
    const diagnostics = {};

    const data = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom.test",
      model: TEST_MODEL,
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("openai-responses request did not project to text messages[]");
  });

  it("skips Responses tool/reasoning history instead of collapsing it into a message (#2132)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: "user", content: "compressed tool history" }],
        tokens_saved: 10,
      }),
    }));

    const input = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "investigate bug" }],
      },
      {
        type: "function_call",
        call_id: "call_apply_patch_123",
        name: "apply_patch",
        arguments: "*** Begin Patch\n*** End Patch",
      },
      {
        type: "function_call_output",
        call_id: "call_apply_patch_123",
        output: "ok",
      },
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Need a plan" }],
      },
    ];
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
      model: TEST_MODEL,
      format: "openai-responses",
      diagnostics,
    });

    expect(data).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.input).toEqual(input);
    expect(diagnostics.reason).toBe("skipped: openai-responses tool/reasoning input is not safe to compress");
  });
});
