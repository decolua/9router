import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  interpolateTemplate,
  interpolateObject,
  executeRequestTransformer,
  executeResponseTransformer,
  executeStreamChunkTransformer,
  compileTransformer,
} from "../../open-sse/custom-adapters/transformer.js";
import {
  registerCustomAdapter,
  unregisterCustomAdapter,
  getCustomAdapter,
  getAllCustomAdapters,
  normalizeAdapterDefinition,
} from "../../open-sse/custom-adapters/loader.js";
import { CustomAdapterExecutor } from "../../open-sse/executors/customAdapter.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { parseModel, getModelInfo } from "../../src/sse/services/model.js";

describe("Custom Provider Adapters", () => {
  beforeEach(() => {
    // Clean up any test adapters
    unregisterCustomAdapter("test-custom-adapter");
    unregisterCustomAdapter("test-scripted-adapter");
  });

  afterEach(() => {
    unregisterCustomAdapter("test-custom-adapter");
    unregisterCustomAdapter("test-scripted-adapter");
  });

  describe("Template Interpolation", () => {
    it("interpolates credentials and model in template strings", () => {
      const context = {
        credentials: { apiKey: "sk-12345", cookie: "sess_abc" },
        model: "gpt-4o-custom",
        baseUrl: "https://api.my-gateway.com/v1",
      };

      expect(interpolateTemplate("Bearer {{apiKey}}", context)).toBe("Bearer sk-12345");
      expect(interpolateTemplate("session_id={{cookie}}", context)).toBe("session_id=sess_abc");
      expect(interpolateTemplate("{{baseUrl}}/models/{{model}}", context)).toBe(
        "https://api.my-gateway.com/v1/models/gpt-4o-custom"
      );
    });

    it("interpolates environment variables via {{env.KEY}}", () => {
      process.env.TEST_CUSTOM_SECRET = "super-secret-token";
      const res = interpolateTemplate("Token {{env.TEST_CUSTOM_SECRET}}", {});
      expect(res).toBe("Token super-secret-token");
      delete process.env.TEST_CUSTOM_SECRET;
    });

    it("deeply interpolates nested objects and arrays", () => {
      const context = {
        apiKey: "key-999",
        model: "fast-model",
      };
      const rawObj = {
        headers: {
          Authorization: "Bearer {{apiKey}}",
          "X-Model": "{{model}}",
        },
        items: ["item-{{model}}", { key: "{{apiKey}}" }],
      };

      const result = interpolateObject(rawObj, context);
      expect(result.headers.Authorization).toBe("Bearer key-999");
      expect(result.headers["X-Model"]).toBe("fast-model");
      expect(result.items[0]).toBe("item-fast-model");
      expect(result.items[1].key).toBe("key-999");
    });
  });

  describe("Declarative Request and Response Mapping", () => {
    const declarativeAdapter = {
      id: "test-custom-adapter",
      name: "Test Custom Gateway",
      prefix: "test-gw",
      baseUrl: "https://api.example.com/v1/generate",
      authType: "apikey",
      headers: {
        "X-Api-Key": "{{apiKey}}",
        "X-Client": "9router",
      },
      requestMapping: {
        promptParam: "prompt",
        modelParam: "engine",
        streamParam: "stream_mode",
      },
      responseMapping: {
        contentPath: "data.result.text",
        reasoningPath: "data.result.thinking",
        usagePath: "data.usage",
      },
      models: [{ id: "model-1", name: "Model 1" }],
    };

    it("transforms request body from OpenAI chat format to target API schema", () => {
      const openAiBody = {
        model: "model-1",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello world!" },
        ],
        stream: true,
      };

      const transformed = executeRequestTransformer(declarativeAdapter, {
        model: "model-1",
        body: openAiBody,
        credentials: { apiKey: "test-key" },
        stream: true,
      });

      expect(transformed.body.engine).toBe("model-1");
      expect(transformed.body.prompt).toContain("system: You are a helpful assistant.");
      expect(transformed.body.prompt).toContain("user: Hello world!");
      expect(transformed.body.stream_mode).toBe(true);
      expect(transformed.headers["X-Api-Key"]).toBe("test-key");
    });

    it("transforms target API response JSON into OpenAI chat completion format", () => {
      const upstreamResponse = {
        data: {
          result: {
            text: "This is a response from the custom endpoint.",
            thinking: "I am thinking carefully.",
          },
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        },
      };

      const transformed = executeResponseTransformer(declarativeAdapter, upstreamResponse, {}, "model-1");

      expect(transformed.object).toBe("chat.completion");
      expect(transformed.model).toBe("model-1");
      expect(transformed.choices[0].message.content).toBe("This is a response from the custom endpoint.");
      expect(transformed.choices[0].message.reasoning_content).toBe("I am thinking carefully.");
      expect(transformed.usage.total_tokens).toBe(30);
    });

    it("transforms SSE streaming lines to OpenAI chunk format", () => {
      const sseLine = 'data: {"delta": "Hello ", "thinking": "Let me see"}';
      const chunk = executeStreamChunkTransformer(declarativeAdapter, sseLine, { id: 123 }, "model-1");

      expect(chunk).not.toBeNull();
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(chunk.choices[0].delta.content).toBe("Hello ");
      expect(chunk.choices[0].delta.reasoning_content).toBe("Let me see");
    });
  });

  describe("Scripted JS Transformers", () => {
    const scriptedAdapter = {
      id: "test-scripted-adapter",
      name: "Test Scripted Gateway",
      prefix: "test-scripted",
      baseUrl: "https://unofficial.api.local",
      authType: "cookie",
      transformRequest: `(context) => {
        const lastUser = context.body.messages.find(m => m.role === "user");
        return {
          url: context.baseUrl + "/v2/chat",
          headers: { ...context.headers, "X-Auth": context.credentials.apiKey },
          body: {
            user_query: lastUser ? lastUser.content : "",
            model_selected: context.model,
          }
        };
      }`,
      transformResponse: `(raw, state, context) => {
        return {
          id: "chatcmpl-scripted",
          object: "chat.completion",
          created: 1234567890,
          model: context.model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: raw.custom_output_field },
            finish_reason: "stop"
          }]
        };
      }`,
      transformStreamChunk: `(chunk, state, context) => {
        if (typeof chunk === "string" && chunk.startsWith("data:")) {
          const parsed = JSON.parse(chunk.slice(5).trim());
          return {
            id: "chatcmpl-chunk",
            object: "chat.completion.chunk",
            created: 1234567890,
            model: context.model,
            choices: [{ index: 0, delta: { content: parsed.token_text }, finish_reason: null }]
          };
        }
        return null;
      }`,
      models: [{ id: "scripted-model-1", name: "Scripted Model 1" }],
    };

    it("executes scripted transformRequest", () => {
      const transformed = executeRequestTransformer(scriptedAdapter, {
        model: "scripted-model-1",
        body: { messages: [{ role: "user", content: "What is AI?" }] },
        credentials: { apiKey: "secret-key-1" },
        headers: { "Content-Type": "application/json" },
        stream: false,
      });

      expect(transformed.url).toBe("https://unofficial.api.local/v2/chat");
      expect(transformed.headers["X-Auth"]).toBe("secret-key-1");
      expect(transformed.body.user_query).toBe("What is AI?");
      expect(transformed.body.model_selected).toBe("scripted-model-1");
    });

    it("executes scripted transformResponse", () => {
      const raw = { custom_output_field: "AI is artificial intelligence." };
      const res = executeResponseTransformer(scriptedAdapter, raw, {}, "scripted-model-1");

      expect(res.object).toBe("chat.completion");
      expect(res.choices[0].message.content).toBe("AI is artificial intelligence.");
    });

    it("executes scripted transformStreamChunk", () => {
      const chunk = executeStreamChunkTransformer(
        scriptedAdapter,
        'data: {"token_text": "Hello"}',
        {},
        "scripted-model-1"
      );

      expect(chunk.object).toBe("chat.completion.chunk");
      expect(chunk.choices[0].delta.content).toBe("Hello");
    });
  });

  describe("Loader and Runtime Registry", () => {
    it("registers custom adapter and synchronizes with PROVIDERS and PROVIDER_MODELS", () => {
      const adapter = registerCustomAdapter({
        id: "test-custom-adapter",
        prefix: "my-prefix",
        name: "My Prefix Adapter",
        baseUrl: "https://api.my-prefix.com",
        models: [{ id: "model-alpha", name: "Model Alpha" }],
      });

      expect(adapter).not.toBeNull();
      expect(getCustomAdapter("test-custom-adapter")).toBeDefined();
      expect(getCustomAdapter("my-prefix")).toBeDefined();

      // Verify injected into runtime PROVIDERS & PROVIDER_MODELS
      expect(PROVIDERS["test-custom-adapter"]).toBeDefined();
      expect(PROVIDER_MODELS["my-prefix"]).toBeDefined();
      expect(PROVIDER_MODELS["my-prefix"][0].id).toBe("model-alpha");

      // Verify unregister cleans up properly
      unregisterCustomAdapter("test-custom-adapter");
      expect(getCustomAdapter("test-custom-adapter")).toBeNull();
      expect(PROVIDERS["test-custom-adapter"]).toBeUndefined();
    });
  });

  describe("CustomAdapterExecutor Execution", () => {
    it("builds headers with auth and interpolates template strings", () => {
      const adapter = {
        id: "test-custom-adapter",
        baseUrl: "https://api.test.com/v1",
        authType: "bearer",
        headers: {
          "X-Session": "{{cookie}}",
        },
      };

      const executor = new CustomAdapterExecutor("test-custom-adapter", null, adapter);
      const headers = executor.buildHeaders(
        { apiKey: "sk-my-key", cookie: "cookie-val" },
        true,
        "https://api.test.com/v1",
        "my-model"
      );

      expect(headers["Authorization"]).toBe("Bearer sk-my-key");
      expect(headers["X-Session"]).toBe("cookie-val");
      expect(headers["Accept"]).toContain("text/event-stream");
    });

    it("executes non-streaming request and transforms output", async () => {
      const adapter = {
        id: "test-custom-adapter",
        baseUrl: "https://api.test.com/v1/generate",
        authType: "apikey",
        responseMapping: {
          contentPath: "result.response_text",
        },
        models: [{ id: "model-x", name: "Model X" }],
      };

      const executor = new CustomAdapterExecutor("test-custom-adapter", null, adapter);

      const spy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(
        new Response(JSON.stringify({ result: { response_text: "Mocked custom endpoint answer" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      try {
        const { response } = await executor.execute({
          model: "model-x",
          body: { messages: [{ role: "user", content: "Test" }] },
          stream: false,
          credentials: { apiKey: "test-api-key" },
        });

        const json = await response.json();
        expect(response.status).toBe(200);
        expect(json.object).toBe("chat.completion");
        expect(json.choices[0].message.content).toBe("Mocked custom endpoint answer");
      } finally {
        spy.mockRestore();
      }
    });

    it("executes streaming request and transforms incoming SSE lines", async () => {
      const adapter = {
        id: "test-custom-adapter",
        baseUrl: "https://api.test.com/v1/generate",
        authType: "apikey",
        streamMapping: {
          deltaPath: "token",
        },
        models: [{ id: "model-stream", name: "Model Stream" }],
      };

      const executor = new CustomAdapterExecutor("test-custom-adapter", null, adapter);

      const encoder = new TextEncoder();
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"token": "Hello "}\n\n'));
          controller.enqueue(encoder.encode('data: {"token": "World!"}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      const spy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(
        new Response(mockStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );

      try {
        const { response } = await executor.execute({
          model: "model-stream",
          body: { messages: [{ role: "user", content: "Hi" }], stream: true },
          stream: true,
          credentials: { apiKey: "test-api-key" },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");

        const text = await response.text();
        expect(text).toContain("chat.completion.chunk");
        expect(text).toContain("Hello ");
        expect(text).toContain("World!");
        expect(text).toContain("data: [DONE]");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("Model Prefix Routing", () => {
    it("routes prefix/model string to the custom adapter provider", async () => {
      registerCustomAdapter({
        id: "test-custom-adapter",
        prefix: "custom-gw",
        name: "Custom Gateway",
        baseUrl: "https://api.custom-gw.local",
        models: [{ id: "claude-custom", name: "Claude Custom" }],
      });

      const modelInfo = await getModelInfo("custom-gw/claude-custom");
      expect(modelInfo.provider).toBe("test-custom-adapter");
      expect(modelInfo.model).toBe("claude-custom");
    });
  });
});
