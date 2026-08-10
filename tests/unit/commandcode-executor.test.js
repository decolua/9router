import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";

const baseExecute = vi.spyOn(BaseExecutor.prototype, "execute");
const MUSE_MODEL = "meta/muse-spark-1.2-contributor";

afterAll(() => baseExecute.mockRestore());

describe("CommandCodeExecutor", () => {
  beforeEach(() => {
    baseExecute.mockReset();
  });

  it("uses the current protocol version and exposes Muse Contributor", () => {
    const executor = new CommandCodeExecutor();
    const headers = executor.buildHeaders({ apiKey: "user-test" });

    expect(headers["x-command-code-version"]).toBe("1.15.1");
    expect(headers["x-cli-environment"]).toBe("cli");
    expect(PROVIDER_MODELS.commandcode).toContainEqual({
      id: "meta/muse-spark-1.2-contributor",
      name: "Muse Spark 1.2 Contributor",
    });
  });

  it("advertises Muse as a Command Code reasoning model with the exact API levels", () => {
    expect(getCapabilitiesForModel("commandcode", MUSE_MODEL)).toMatchObject({
      reasoning: true,
      thinkingFormat: "commandcode",
      thinkingCanDisable: false,
      maxOutput: 32768,
    });
    expect(getThinkingLevels("commandcode", MUSE_MODEL)).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
  });

  it.each(["low", "medium", "high", "xhigh", "max"])(
    "forwards Muse reasoning_effort=%s into params unchanged",
    (effort) => {
      const translated = translateRequest(
        FORMATS.OPENAI,
        FORMATS.COMMANDCODE,
        MUSE_MODEL,
        {
          messages: [{ role: "user", content: "hello" }],
          reasoning_effort: effort,
        },
        true,
        null,
        "commandcode",
      );

      expect(translated.params.model).toBe(MUSE_MODEL);
      expect(translated.params.reasoning_effort).toBe(effort);
      expect(translated.reasoning_effort).toBeUndefined();
    },
  );

  it("does not send unsupported auto/none values to Command Code", () => {
    for (const effort of ["auto", "none"]) {
      const translated = translateRequest(
        FORMATS.OPENAI,
        FORMATS.COMMANDCODE,
        MUSE_MODEL,
        {
          messages: [{ role: "user", content: "hello" }],
          reasoning_effort: effort,
        },
        true,
        null,
        "commandcode",
      );

      expect(translated.params.reasoning_effort).toBeUndefined();
    }
  });

  it("uses a clean upstream model when the selected model carries an effort suffix", () => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.COMMANDCODE,
      `${MUSE_MODEL}(high)`,
      { messages: [{ role: "user", content: "hello" }] },
      true,
      null,
      "commandcode",
    );

    expect(translated.params.model).toBe(MUSE_MODEL);
    expect(translated.params.reasoning_effort).toBe("high");
  });

  it("wraps normal NDJSON as OpenAI SSE", async () => {
    baseExecute.mockResolvedValue({
      response: new Response(
        '{"type":"start"}\n{"type":"text-delta","text":"OK"}\n{"type":"finish"}\n',
        { status: 200 },
      ),
      url: "https://api.commandcode.ai/alpha/generate",
      headers: {},
      transformedBody: {},
    });

    const result = await new CommandCodeExecutor().execute({
      model: "meta/muse-spark-1.2-contributor",
      body: {},
      stream: true,
      credentials: { apiKey: "user-test" },
    });
    const text = await result.response.text();

    expect(result.response.status).toBe(200);
    expect(text).toContain('data: {"id":"chatcmpl-');
    expect(text).toContain('"content":"OK"');
    expect(text).toContain("data: [DONE]");
  });

  it("retries retryable in-band errors before exposing an HTTP error", async () => {
    let calls = 0;
    const proxyOptions = [];
    baseExecute.mockImplementation(async (receivedOpts) => {
      calls++;
      proxyOptions.push(receivedOpts.proxyOptions);
      if (calls === 1) {
        return {
          response: new Response(
            '{"type":"start"}\n{"type":"error","error":{"message":"temporary","statusCode":503,"isRetryable":true}}\n',
            { status: 200 },
          ),
          url: "https://api.commandcode.ai/alpha/generate",
          headers: {},
          transformedBody: {},
        };
      }
      return {
        response: new Response(
          '{"type":"start"}\n{"type":"text-delta","text":"OK"}\n{"type":"finish"}\n',
          { status: 200 },
        ),
        url: "https://api.commandcode.ai/alpha/generate",
        headers: {},
        transformedBody: {},
      };
    });

    const result = await new CommandCodeExecutor().execute({
      model: "meta/muse-spark-1.2-contributor",
      body: {},
      stream: true,
      credentials: { apiKey: "user-test" },
      proxyOptions: {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy.example",
      },
    });

    expect(calls).toBe(2);
    expect(proxyOptions[1]).toEqual(proxyOptions[0]);
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toContain('"content":"OK"');
  });

  it("returns a real HTTP error when the in-band error persists", async () => {
    baseExecute.mockImplementation(async () => ({
      response: new Response(
        '{"type":"start"}\n{"type":"error","error":{"message":"unavailable","statusCode":503,"isRetryable":true}}\n',
        { status: 200 },
      ),
      url: "https://api.commandcode.ai/alpha/generate",
      headers: {},
      transformedBody: {},
    }));

    const result = await new CommandCodeExecutor().execute({
      model: "meta/muse-spark-1.2-contributor",
      body: {},
      stream: true,
      credentials: { apiKey: "user-test" },
    });
    const body = await result.response.json();

    expect(result.response.status).toBe(503);
    expect(body.error.message).toBe("unavailable");
  });

  it("does not add an unsupported root-level stream field", () => {
    const body = {
      model: "meta/muse-spark-1.2-contributor",
      stream: true,
      params: { model: "meta/muse-spark-1.2-contributor", stream: true },
    };
    const transformed = new CommandCodeExecutor().transformRequest(
      "meta/muse-spark-1.2-contributor",
      body,
      true,
    );

    expect(transformed).not.toHaveProperty("model");
    expect(transformed).not.toHaveProperty("stream");
    expect(transformed.params).toEqual(body.params);
  });

  it("clamps tool-bearing Muse requests to Command Code's supported limit", () => {
    const request = openaiToCommandCodeRequest(
      "meta/muse-spark-1.2-contributor",
      {
        max_tokens: 64000,
        messages: [{ role: "user", content: "hello" }],
        tools: [{
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        }],
      },
      true,
    );

    expect(request.params.max_tokens).toBe(32768);
  });
});
