import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  FactoryExecutor,
  resolveTargetGateway,
  upstreamProviderFor,
  resolveFactoryApiBase,
  FACTORY_DROID_SYSTEM_PROMPT,
  FACTORY_OPENAI_PLATFORM_ORG,
  ANTHROPIC_VERSION,
  ANTHROPIC_BETAS,
} from "../../open-sse/executors/factory.js";

describe("FactoryExecutor", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FACTORY_API_BASE;
    delete process.env.FACTORY_ORG_ID;
    delete process.env.FACTORY_ORGANIZATION_ID;
    delete process.env.FACTORY_UPSTREAM_CLIENT_TYPE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("resolveTargetGateway", () => {
    it("routes Claude and MiniMax models to Anthropic Messages gateway", () => {
      expect(resolveTargetGateway("claude-opus-5")).toBe("anthropic");
      expect(resolveTargetGateway("claude-sonnet-5")).toBe("anthropic");
      expect(resolveTargetGateway("claude-fable-5")).toBe("anthropic");
      expect(resolveTargetGateway("atlas-07-21")).toBe("anthropic");
      expect(resolveTargetGateway("aster-07-15")).toBe("anthropic");
      expect(resolveTargetGateway("minimax-m3")).toBe("anthropic");
      expect(resolveTargetGateway("minimax-m2.7")).toBe("anthropic");
    });

    it("routes GPT, Codex, and Grok models to OpenAI Responses gateway", () => {
      expect(resolveTargetGateway("gpt-6-astra")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5.6-sol")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5.4")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5.3-codex")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5-codex")).toBe("openai-responses");
      expect(resolveTargetGateway("grok-4.6")).toBe("openai-responses");
      expect(resolveTargetGateway("grok-4.5")).toBe("openai-responses");
    });

    it("routes Core open-weight models to OpenAI Chat Completions gateway", () => {
      expect(resolveTargetGateway("glm-5.3")).toBe("openai-completions");
      expect(resolveTargetGateway("glm-5.2")).toBe("openai-completions");
      expect(resolveTargetGateway("kimi-k3")).toBe("openai-completions");
      expect(resolveTargetGateway("kimi-k2.7-code")).toBe("openai-completions");
      expect(resolveTargetGateway("deepseek-v4-pro")).toBe("openai-completions");
      expect(resolveTargetGateway("deepseek-v4-flash-0731")).toBe("openai-completions");
      expect(resolveTargetGateway("nemotron-3-ultra")).toBe("openai-completions");
      expect(resolveTargetGateway("inkling")).toBe("openai-completions");
    });
  });

  describe("upstreamProviderFor", () => {
    it("returns anthropic for Claude family", () => {
      expect(upstreamProviderFor("claude-opus-5")).toBe("anthropic");
      expect(upstreamProviderFor("claude-sonnet-4-6")).toBe("anthropic");
      expect(upstreamProviderFor("atlas-07-21")).toBe("anthropic");
    });

    it("returns openai for GPT and Codex models", () => {
      expect(upstreamProviderFor("gpt-6-astra")).toBe("openai");
      expect(upstreamProviderFor("gpt-5.6-sol")).toBe("openai");
      expect(upstreamProviderFor("gpt-5.3-codex")).toBe("openai");
    });

    it("returns xai for Grok models", () => {
      expect(upstreamProviderFor("grok-4.6")).toBe("xai");
      expect(upstreamProviderFor("grok-4.5")).toBe("xai");
    });

    it("returns fireworks for open models and MiniMax", () => {
      expect(upstreamProviderFor("minimax-m3")).toBe("fireworks");
      expect(upstreamProviderFor("glm-5.3")).toBe("fireworks");
      expect(upstreamProviderFor("kimi-k3")).toBe("fireworks");
      expect(upstreamProviderFor("deepseek-v4-pro")).toBe("fireworks");
      expect(upstreamProviderFor("nemotron-3-ultra")).toBe("fireworks");
      expect(upstreamProviderFor("inkling")).toBe("fireworks");
    });
  });

  describe("resolveFactoryApiBase", () => {
    it("defaults to https://api.factory.ai", () => {
      expect(resolveFactoryApiBase()).toBe("https://api.factory.ai");
    });

    it("uses credentials.providerSpecificData.apiEndpoint if provided", () => {
      const creds = { providerSpecificData: { apiEndpoint: "https://api.eu.factory.ai/" } };
      expect(resolveFactoryApiBase(creds)).toBe("https://api.eu.factory.ai");
    });

    it("prefers FACTORY_API_BASE environment variable over credentials", () => {
      process.env.FACTORY_API_BASE = "https://custom.factory.ai/";
      const creds = { providerSpecificData: { apiEndpoint: "https://api.eu.factory.ai" } };
      expect(resolveFactoryApiBase(creds)).toBe("https://custom.factory.ai");
    });
  });

  describe("buildUrl", () => {
    const executor = new FactoryExecutor();

    it("builds correct URL for Anthropic gateway", () => {
      const url = executor.buildUrl("claude-opus-5", true);
      expect(url).toBe("https://api.factory.ai/api/llm/a/v1/messages");
    });

    it("builds correct URL for MiniMax on Anthropic gateway", () => {
      const url = executor.buildUrl("minimax-m3", true);
      expect(url).toBe("https://api.factory.ai/api/llm/a/v1/messages");
    });

    it("builds correct URL for OpenAI Responses gateway", () => {
      const url = executor.buildUrl("gpt-5.6-sol", true);
      expect(url).toBe("https://api.factory.ai/api/llm/o/v1/responses");
    });

    it("builds correct URL for OpenAI Chat Completions gateway", () => {
      const url = executor.buildUrl("glm-5.3", true);
      expect(url).toBe("https://api.factory.ai/api/llm/o/v1/chat/completions");
    });

    it("respects custom regional apiEndpoint in buildUrl", () => {
      const creds = { providerSpecificData: { apiEndpoint: "https://api.eu.factory.ai" } };
      const url = executor.buildUrl("claude-opus-5", true, 0, creds);
      expect(url).toBe("https://api.eu.factory.ai/api/llm/a/v1/messages");
    });
  });

  describe("buildHeaders", () => {
    const executor = new FactoryExecutor();

    it("builds headers for Anthropic models", () => {
      const creds = { accessToken: "test-token-123", providerSpecificData: { orgId: "org-xyz" } };
      const headers = executor.buildHeaders(creds, true, "", "claude-opus-5");

      expect(headers["Authorization"]).toBe("Bearer test-token-123");
      expect(headers["X-Factory-Client"]).toBe("cli");
      expect(headers["X-Factory-Org-Id"]).toBe("org-xyz");
      expect(headers["x-api-provider"]).toBe("anthropic");
      expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
      expect(headers["anthropic-beta"]).toBe(ANTHROPIC_BETAS);
      expect(headers["Accept"]).toBe("text/event-stream");
    });

    it("builds headers for OpenAI Responses models", () => {
      const creds = { accessToken: "test-token-123" };
      const headers = executor.buildHeaders(creds, true, "", "gpt-5.6-sol");

      expect(headers["x-api-provider"]).toBe("openai");
      expect(headers["OpenAI-Platform"]).toBe(FACTORY_OPENAI_PLATFORM_ORG);
      expect(headers["anthropic-version"]).toBeUndefined();
    });

    it("builds headers for Grok models", () => {
      const creds = { accessToken: "test-token-123" };
      const headers = executor.buildHeaders(creds, true, "", "grok-4.6");

      expect(headers["x-api-provider"]).toBe("xai");
      expect(headers["OpenAI-Platform"]).toBe(FACTORY_OPENAI_PLATFORM_ORG);
    });

    it("builds headers for Chat Completions models", () => {
      const creds = { accessToken: "test-token-123" };
      const headers = executor.buildHeaders(creds, true, "", "glm-5.3");

      expect(headers["x-api-provider"]).toBe("fireworks");
      expect(headers["OpenAI-Platform"]).toBeUndefined();
      expect(headers["anthropic-version"]).toBeUndefined();
    });
  });

  describe("transformRequest", () => {
    const executor = new FactoryExecutor();

    it("prepends Droid system prompt to Claude format request", () => {
      const body = { system: "You are a coding assistant." };
      const transformed = executor.transformRequest("claude-opus-5", body);

      expect(transformed.system).toContain("You are Droid, an AI software engineering agent built by Factory");
      expect(transformed.system).toContain("You are a coding assistant.");
    });

    it("prepends Droid system prompt to OpenAI chat completions request", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }],
      };
      const transformed = executor.transformRequest("glm-5.3", body);

      expect(transformed.messages[0].role).toBe("system");
      expect(transformed.messages[0].content).toContain("You are Droid, an AI software engineering agent built by Factory");
      expect(transformed.reasoning_history).toBe("preserved");
    });

    it("sets interleaved reasoning_history for DeepSeek models", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }],
      };
      const transformed = executor.transformRequest("deepseek-v4-pro", body);

      expect(transformed.reasoning_history).toBe("interleaved");
    });

    it("does not duplicate Droid prompt if already present", () => {
      const body = {
        system: `${FACTORY_DROID_SYSTEM_PROMPT}\n\nCustom prompt`,
      };
      const transformed = executor.transformRequest("claude-opus-5", body);
      const matches = transformed.system.match(/You are Droid, an AI software engineering agent built by Factory/g);
      expect(matches.length).toBe(1);
    });

    it("strips competing 'You are Claude Code' prompt from Anthropic messages", () => {
      const body = {
        system: "You are Claude Code, Anthropic's official CLI for Claude.\n\nPlease help me refactor code.",
      };
      const transformed = executor.transformRequest("claude-fable-5.1", body, false);
      expect(transformed.system).not.toContain("You are Claude Code");
      expect(transformed.system).toContain("Please help me refactor code.");
      expect(transformed.system).toContain(FACTORY_DROID_SYSTEM_PROMPT);
      expect(transformed.max_tokens).toBe(4096);
      expect(transformed.stream).toBe(false);
    });

    it("preserves existing max_tokens if already set on Anthropic messages", () => {
      const body = {
        system: "Hello",
        max_tokens: 8192,
      };
      const transformed = executor.transformRequest("claude-fable-5.1", body, true);
      expect(transformed.max_tokens).toBe(8192);
      expect(transformed.stream).toBe(true);
    });

    it("strips competing prompt from OpenAI chat completions", () => {
      const body = {
        messages: [
          { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude. Be helpful." },
          { role: "user", content: "Ping" },
        ],
      };
      const transformed = executor.transformRequest("kimi-k3", body, false);
      const sysMsg = transformed.messages.find((m) => m.role === "system");
      expect(sysMsg.content).not.toContain("You are Claude Code");
      expect(sysMsg.content).toContain("Be helpful.");
      expect(sysMsg.content).toContain(FACTORY_DROID_SYSTEM_PROMPT);
    });

    it("extracts system prompt to instructions and strips competing identity in OpenAI responses format", () => {
      const body = {
        input: [
          { role: "system", content: "You are Claude Code, Anthropic's official CLI for Claude. Solve math." },
          { role: "user", content: "2+2" },
        ],
      };
      const transformed = executor.transformRequest("gpt-5.4", body, true);
      expect(transformed.instructions).not.toContain("You are Claude Code");
      expect(transformed.instructions).toContain("Solve math.");
      expect(transformed.instructions).toContain(FACTORY_DROID_SYSTEM_PROMPT);
      expect(transformed.input.length).toBe(1);
      expect(transformed.input[0].role).toBe("user");
      expect(transformed.stream).toBe(true);
    });

    it("sets Accept header application/json for non-streaming and text/event-stream for streaming", () => {
      const creds = { accessToken: "test-token" };
      const streamHeaders = executor.buildHeaders(creds, true, "", "kimi-k3");
      expect(streamHeaders["Accept"]).toBe("text/event-stream");

      const jsonHeaders = executor.buildHeaders(creds, false, "", "kimi-k3");
      expect(jsonHeaders["Accept"]).toBe("application/json");
    });
  });
});
