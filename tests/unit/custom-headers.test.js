import { describe, it, expect } from "vitest";
import {
  parseCustomHeaders,
  formatCustomHeaders,
  applyCustomHeaders,
} from "../../open-sse/utils/customHeaders.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import openaiCompatNode from "../../open-sse/handlers/embeddingProviders/openaiCompatNode.js";

describe("Custom Headers Utility", () => {
  describe("parseCustomHeaders", () => {
    it("parses valid JSON object string", () => {
      const input = JSON.stringify({
        "HTTP-Referer": "https://myapp.com",
        "X-Title": "My App",
      });
      expect(parseCustomHeaders(input)).toEqual({
        "HTTP-Referer": "https://myapp.com",
        "X-Title": "My App",
      });
    });

    it("parses newline-separated Key: Value lines", () => {
      const input = "HTTP-Referer: https://myapp.com\nX-Title: My App\n# Comment\n// Comment 2";
      expect(parseCustomHeaders(input)).toEqual({
        "HTTP-Referer": "https://myapp.com",
        "X-Title": "My App",
      });
    });

    it("handles already parsed object input", () => {
      const obj = { "x-custom": "test", "another": "val" };
      expect(parseCustomHeaders(obj)).toEqual({
        "x-custom": "test",
        "another": "val",
      });
    });

    it("returns null for empty or invalid inputs", () => {
      expect(parseCustomHeaders(null)).toBeNull();
      expect(parseCustomHeaders("")).toBeNull();
      expect(parseCustomHeaders("   ")).toBeNull();
      expect(parseCustomHeaders({})).toBeNull();
      expect(parseCustomHeaders([])).toBeNull();
      expect(parseCustomHeaders("invalid string without colons")).toBeNull();
    });
  });

  describe("formatCustomHeaders", () => {
    it("formats object to JSON string", () => {
      const obj = { "x-test": "123" };
      const formatted = formatCustomHeaders(obj);
      expect(JSON.parse(formatted)).toEqual(obj);
    });

    it("returns empty string for null/empty inputs", () => {
      expect(formatCustomHeaders(null)).toBe("");
      expect(formatCustomHeaders(undefined)).toBe("");
      expect(formatCustomHeaders("")).toBe("");
    });
  });

  describe("applyCustomHeaders", () => {
    it("merges custom headers into target headers", () => {
      const headers = { "Content-Type": "application/json", Authorization: "Bearer test" };
      const custom = { "X-Custom": "val", "HTTP-Referer": "https://example.com" };
      applyCustomHeaders(headers, custom);
      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer test",
        "X-Custom": "val",
        "HTTP-Referer": "https://example.com",
      });
    });

    it("interpolates {{API_KEY}} and {{apiKey}} placeholders", () => {
      const headers = { "Content-Type": "application/json" };
      const custom = {
        "api-key": "{{API_KEY}}",
        "x-sub-key": "{{apiKey}}",
      };
      const credentials = { apiKey: "secret-key-123" };
      applyCustomHeaders(headers, custom, credentials);
      expect(headers["api-key"]).toBe("secret-key-123");
      expect(headers["x-sub-key"]).toBe("secret-key-123");
    });

    it("suppresses/removes header when value is empty string or null", () => {
      const headers = {
        "Content-Type": "application/json",
        Authorization: "Bearer default",
        "x-keep": "stay",
      };
      const custom = {
        Authorization: "",
        "api-key": "my-key",
      };
      applyCustomHeaders(headers, custom, { apiKey: "my-key" });
      expect(headers.Authorization).toBeUndefined();
      expect(headers["authorization"]).toBeUndefined();
      expect(headers["api-key"]).toBe("my-key");
      expect(headers["x-keep"]).toBe("stay");
    });
  });

  describe("Executor Integration", () => {
    it("BaseExecutor applies customHeaders from credentials", () => {
      const executor = new BaseExecutor("openai-compatible-test", { baseUrl: "https://api.openai.com/v1" });
      const credentials = {
        apiKey: "test-key",
        providerSpecificData: {
          customHeaders: {
            "X-Base-Custom": "base-val",
          },
        },
      };
      const headers = executor.buildHeaders(credentials, false);
      expect(headers["X-Base-Custom"]).toBe("base-val");
      expect(headers["Authorization"]).toBe("Bearer test-key");
    });

    it("DefaultExecutor applies customHeaders for openai-compatible node", () => {
      const executor = new DefaultExecutor("openai-compatible-chat-node");
      const credentials = {
        apiKey: "sk-proj-test",
        providerSpecificData: {
          baseUrl: "https://custom.gateway.com/v1",
          customHeaders: {
            "HTTP-Referer": "https://myapp.dev",
            "X-Title": "My App",
            "cf-aig-metadata": "prod",
          },
        },
      };
      const headers = executor.buildHeaders(credentials, true, "https://custom.gateway.com/v1", "gpt-4o");
      expect(headers["HTTP-Referer"]).toBe("https://myapp.dev");
      expect(headers["X-Title"]).toBe("My App");
      expect(headers["cf-aig-metadata"]).toBe("prod");
      expect(headers["Authorization"]).toBe("Bearer sk-proj-test");
    });

    it("DefaultExecutor allows replacing Authorization with api-key", () => {
      const executor = new DefaultExecutor("openai-compatible-chat-azure");
      const credentials = {
        apiKey: "azure-secret-key",
        providerSpecificData: {
          baseUrl: "https://custom.azure.com/v1",
          customHeaders: {
            Authorization: "",
            "api-key": "{{API_KEY}}",
          },
        },
      };
      const headers = executor.buildHeaders(credentials, false, "https://custom.azure.com/v1", "gpt-4o");
      expect(headers["api-key"]).toBe("azure-secret-key");
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("DefaultExecutor applies customHeaders for standard providers like openrouter", () => {
      const executor = new DefaultExecutor("openrouter");
      const credentials = {
        apiKey: "sk-or-v1-test",
        providerSpecificData: {
          customHeaders: {
            "HTTP-Referer": "https://9router.local",
            "X-Title": "9Router Gateway",
          },
        },
      };
      const headers = executor.buildHeaders(credentials, true, "https://openrouter.ai/api/v1", "anthropic/claude-3");
      expect(headers["HTTP-Referer"]).toBe("https://9router.local");
      expect(headers["X-Title"]).toBe("9Router Gateway");
      expect(headers["Authorization"]).toBe("Bearer sk-or-v1-test");
    });
  });

  describe("Embedding Adapter Integration", () => {
    it("openaiCompatNode applies customHeaders in buildHeaders", () => {
      const creds = {
        apiKey: "embed-key",
        providerSpecificData: {
          baseUrl: "https://embed.service.com/v1",
          customHeaders: {
            "X-Embed-Tenant": "tenant-42",
          },
        },
      };
      const headers = openaiCompatNode.buildHeaders(creds);
      expect(headers["X-Embed-Tenant"]).toBe("tenant-42");
      expect(headers["Authorization"]).toBe("Bearer embed-key");
    });
  });
});
