import { afterEach, describe, expect, it, vi } from "vitest";
import "./registerAll.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { parseModel } from "../../open-sse/services/model.js";
import { getTargetFormat } from "../../open-sse/services/provider.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Reused and frozen so any in-place schema normalization fails immediately.
const schema = deepFreeze({
  type: "object",
  description: "Nested structured output",
  properties: {
    quasar_rows: {
      type: "array",
      description: "Result rows",
      items: {
        type: "object",
        properties: {
          obsidian_count: { type: "integer", description: "The count" },
          velvet_note: {
            description: "An optional value in a required field",
            anyOf: [{ type: "string", description: "A note" }, { type: "null" }],
          },
          amber_tags: { type: ["array", "null"], items: { type: "string" } },
        },
        required: ["obsidian_count", "velvet_note", "amber_tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["quasar_rows"],
  additionalProperties: false,
});

function chatBody(responseFormat, stream = true) {
  return {
    model: "cx/gpt-6-luna",
    messages: [{ role: "user", content: "Return one result." }],
    stream,
    ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
  };
}

const schemaOptions = [
  { label: "strict true", strict: true },
  { label: "strict false", strict: false },
  { label: "strict absent" },
];

const formatCases = [
  ...schemaOptions.map(({ label, ...options }) => ({
    label,
    source: { type: "json_schema", json_schema: { name: "nested_result", ...options, schema } },
    expected: { type: "json_schema", name: "nested_result", ...options, schema },
  })),
  {
    label: "description",
    source: { type: "json_schema", json_schema: { name: "described", description: "Format description", strict: true, schema } },
    expected: { type: "json_schema", name: "described", description: "Format description", strict: true, schema },
  },
  {
    label: "empty description",
    source: { type: "json_schema", json_schema: { name: "described", description: "", schema } },
    expected: { type: "json_schema", name: "described", description: "", schema },
  },
  { label: "json_object", source: { type: "json_object" }, expected: { type: "json_object" } },
  { label: "text", source: { type: "text" }, expected: { type: "text" } },
  { label: "no response_format", source: undefined, expected: undefined },
];

describe("Chat Completions → Responses structured outputs", () => {
  it.each(formatCases)("preserves $label without mutating the request or shared schema", ({ source, expected }) => {
    const body = deepFreeze(chatBody(source));
    const original = structuredClone(body);
    const result = openaiToOpenAIResponsesRequest("gpt-6-luna", body, true);

    expect(result.text).toStrictEqual(expected === undefined ? undefined : { format: expected });
    expect(result).not.toHaveProperty("response_format");
    expect(result.instructions).toBe("");
    expect(body).toStrictEqual(original);
  });

  it.each([true, false])("keeps the previous default body with stream=%s", (stream) => {
    expect(openaiToOpenAIResponsesRequest("gpt-6-luna", chatBody(undefined, stream), stream)).toStrictEqual({
      model: "gpt-6-luna",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Return one result." }] }],
      stream: true,
      store: false,
      instructions: "",
    });
  });

  it.each([true, false])("preserves native text.format in the early passthrough with stream=%s", (stream) => {
    const text = { verbosity: "low", format: formatCases[1].expected };
    const body = deepFreeze({
      input: [{ role: "user", content: "Return one result." }],
      text,
      stream,
      max_tokens: 100,
      // Native Responses formatting takes precedence over this chat-only field.
      response_format: { type: "json_object" },
    });
    const original = structuredClone(body);
    const result = openaiToOpenAIResponsesRequest("gpt-6-luna", body, stream);

    expect(result.text).toStrictEqual(text);
    expect(result.stream).toBe(true);
    expect(result.max_output_tokens).toBe(100);
    expect(result).not.toHaveProperty("max_tokens");
    expect(body).toStrictEqual(original);
  });
});

afterEach(() => vi.restoreAllMocks());

describe.each(["cx/gpt-6-luna", "cx/gpt-6.1-sol"])("%s outbound Codex request", (modelId) => {
  describe.each([true, false])("client stream=%s", (stream) => {
    it.each(formatCases)("sends $label through translateRequest and CodexExecutor", async ({ source, expected }) => {
      const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(new Response("", { status: 200 }));
      const { provider, model } = parseModel(modelId);
      const target = getTargetFormat(provider);
      const credentials = { accessToken: "fixture-token", connectionId: "structured-output-fixture" };
      const body = { ...chatBody(source, stream), model: modelId };
      const original = structuredClone(body);
      deepFreeze(body.response_format);

      expect(provider).toBe("codex");
      expect(target).toBe(FORMATS.OPENAI_RESPONSES);
      const translated = translateRequest(FORMATS.OPENAI, target, model, body, stream, credentials, provider);
      // Ensure the registered translator actually ran (no empty-registry false pass).
      expect(translated.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "Return one result." }] }]);
      await new CodexExecutor().execute({ model, body: translated, stream, credentials });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      const outgoing = JSON.parse(options.body);
      expect(outgoing.text).toStrictEqual(expected === undefined ? undefined : { format: expected });
      expect(outgoing.model).toBe(model);
      expect(outgoing.stream).toBe(true); // Codex transport always streams.
      expect(outgoing).not.toHaveProperty("response_format");
      expect(body).toStrictEqual(original);
    });

    it("preserves native Responses formatting through the pipeline and executor", async () => {
      const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(new Response("", { status: 200 }));
      const { provider, model } = parseModel(modelId);
      const text = deepFreeze({ verbosity: "low", format: formatCases[3].expected });
      const body = { model: modelId, input: "Return one result.", text, stream };
      const original = structuredClone(body);
      const credentials = { accessToken: "fixture-token", connectionId: "native-output-fixture" };
      const translated = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, model, { ...body }, stream, credentials, provider);

      await new CodexExecutor().execute({ model, body: translated, stream, credentials });

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toStrictEqual(text);
      expect(body).toStrictEqual(original);
    });

    it("keeps text.format after chatCore processing and serialization", async () => {
      // Stop at the upstream boundary: exercise the real handler, translator and
      // executor, while keeping this request-preservation test independent of SSE parsing.
      const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(new Response(
        JSON.stringify({ error: { message: "End of outbound request fixture" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ));
      const { provider, model } = parseModel(modelId);
      const body = { ...chatBody(formatCases[3].source, stream), model: modelId };
      const result = await handleChatCore({
        body,
        modelInfo: { provider, model },
        credentials: { accessToken: "fixture-token", connectionId: "handler-output-fixture" },
        connectionId: "handler-output-fixture",
        sourceFormatOverride: FORMATS.OPENAI,
        clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
        rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false,
        ponytailEnabled: false, pxpipeEnabled: false,
      });

      expect(result.response.status).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const outgoing = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(outgoing.text).toStrictEqual({ format: formatCases[3].expected });
      expect(outgoing.model).toBe(model);
      expect(outgoing.stream).toBe(true);
      expect(outgoing).not.toHaveProperty("response_format");
    });
  });
});
