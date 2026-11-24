import { describe, expect, it } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { createKimiApiKeyProbe, isKimiApiKeyAccepted } from "../../open-sse/services/kimi.js";

const executor = getExecutor("kimi");
const PLATFORM_OPENAI = "https://api.moonshot.ai/v1/chat/completions";
const PLATFORM_CLAUDE = "https://api.moonshot.ai/anthropic/v1/messages";

function credentials(format, overrides = {}) {
  return { authType: "apikey", apiKey: "sk-platform-123", runtimeTransport: resolveTransport("kimi", format), ...overrides };
}

describe("KimiExecutor platform API keys", () => {
  it("sends OpenAI-format requests to the platform chat endpoint with a bearer key", () => {
    const creds = credentials("openai");
    expect(executor.buildUrl("kimi-k2.6", true, 0, creds)).toBe(PLATFORM_OPENAI);
    const headers = executor.buildHeaders(creds, true, PLATFORM_OPENAI, "kimi-k2.6");
    expect(headers.Authorization).toBe("Bearer sk-platform-123");
    expect(headers["X-Msh-Platform"]).toBeUndefined();
  });

  it("sends Claude-format requests to the platform Anthropic endpoint", () => {
    const creds = credentials("claude");
    expect(executor.buildUrl("kimi-k2.6", true, 0, creds)).toBe(PLATFORM_CLAUDE);
    expect(executor.buildHeaders(creds, true, PLATFORM_CLAUDE, "kimi-k2.6")["x-api-key"]).toBe("sk-platform-123");
  });

  it("sends Responses-format requests to the platform responses endpoint", () => {
    const creds = credentials("openai-responses");
    expect(executor.buildUrl("kimi-k2.6", true, 0, creds)).toBe("https://api.moonshot.ai/v1/responses");
    expect(executor.buildHeaders(creds, true, "", "kimi-k2.6").Authorization).toBe("Bearer sk-platform-123");
  });

  it("falls back to the Claude platform endpoint when no transport was selected", () => {
    expect(executor.buildUrl("kimi-k2.6", true, 0, credentials(null, { runtimeTransport: undefined }))).toBe(PLATFORM_CLAUDE);
  });

  it("does not mutate the caller's credentials", () => {
    const creds = credentials("openai");
    const before = creds.runtimeTransport;
    executor.buildUrl("kimi-k2.6", true, 0, creds);
    expect(creds.runtimeTransport).toBe(before);
  });
});

describe("KimiExecutor Kimi Code credentials", () => {
  it("keeps Kimi Code API keys on the Kimi Code endpoint", () => {
    const url = executor.buildUrl("k3", true, 0, credentials("openai", { apiKey: "sk-kimi-abc" }));
    expect(url).toBe("https://api.kimi.com/coding/v1/chat/completions");
  });

  it("keeps OAuth connections on the Kimi Code endpoint", () => {
    const creds = { authType: "oauth", accessToken: "tok", runtimeTransport: resolveTransport("kimi", "claude") };
    expect(executor.buildUrl("k3", true, 0, creds)).toBe("https://api.kimi.com/coding/v1/messages?beta=true");
  });
});

describe("createKimiApiKeyProbe", () => {
  it("validates platform keys by listing models on the platform", () => {
    const probe = createKimiApiKeyProbe("sk-abc123");
    expect(probe.url).toBe("https://api.moonshot.ai/v1/models");
    expect(probe.options.method).toBe("GET");
    expect(probe.options.headers.Authorization).toBe("Bearer sk-abc123");
  });

  it("validates Kimi Code keys against the Kimi Code endpoint", () => {
    const probe = createKimiApiKeyProbe("sk-kimi-abc123");
    expect(probe.url).toBe("https://api.kimi.com/coding/v1/messages");
    expect(probe.options.headers["x-api-key"]).toBe("sk-kimi-abc123");
  });
});

describe("isKimiApiKeyAccepted", () => {
  it("rejects only authentication failures", () => {
    expect(isKimiApiKeyAccepted(401)).toBe(false);
    expect(isKimiApiKeyAccepted(403)).toBe(false);
  });

  it("accepts responses that got past authentication", () => {
    for (const status of [200, 400, 404, 429]) expect(isKimiApiKeyAccepted(status)).toBe(true);
  });
});
