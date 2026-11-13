import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRequestDetail } from "open-sse/handlers/chatCore/requestDetail.js";

describe("buildRequestDetail apiKey forwarding", () => {
  it("includes apiKey in returned detail object when provided", () => {
    const detail = buildRequestDetail({
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-123",
      apiKey: "sk-test1234567890",
      tokens: { prompt_tokens: 10, completion_tokens: 20 },
      request: { model: "gpt-4o" },
    });

    expect(detail.apiKey).toBe("sk-test1234567890");
    expect(detail.provider).toBe("openai");
    expect(detail.model).toBe("gpt-4o");
    expect(detail.connectionId).toBe("conn-123");
  });

  it("leaves apiKey undefined when not provided", () => {
    const detail = buildRequestDetail({
      provider: "openai",
      model: "gpt-4o",
    });

    expect(detail.apiKey).toBeUndefined();
  });
});

describe("request-details route apiKey enrichment logic", () => {
  function maskApiKey(key) {
    if (!key || typeof key !== "string") return null;
    if (key.length <= 12) return key.charAt(0) + "***";
    return key.slice(0, 8) + "***" + key.slice(-4);
  }

  function enrichDetails(details, apiKeys) {
    const keyMap = new Map();
    for (const k of apiKeys || []) {
      if (k?.key) keyMap.set(k.key, k);
    }

    return (details || []).map((d) => {
      const redacted = { ...d };
      for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
        if (redacted[key] !== undefined) {
          redacted[key] = { redacted: true };
        }
      }

      if (redacted.apiKey) {
        const matched = keyMap.get(redacted.apiKey);
        redacted.apiKeyName = matched?.name || null;
        redacted.apiKey = maskApiKey(redacted.apiKey);
      } else {
        redacted.apiKey = null;
        redacted.apiKeyName = "Local / No Key";
      }

      return redacted;
    });
  }

  it("enriches matched API key with name and masked key", () => {
    const rawKey = "sk-proj-1234567890abcdef1234";
    const apiKeys = [{ id: "key-1", key: rawKey, name: "Production Key" }];
    const details = [{ id: "d-1", model: "claude-3-5-sonnet", apiKey: rawKey }];

    const [enriched] = enrichDetails(details, apiKeys);
    expect(enriched.apiKeyName).toBe("Production Key");
    expect(enriched.apiKey).toBe(rawKey.slice(0, 8) + "***" + rawKey.slice(-4));
    expect(enriched.apiKey).not.toBe(rawKey);
  });

  it("handles unknown/deleted API key with masked key and null apiKeyName", () => {
    const rawKey = "sk-proj-9999999999abcdef9999";
    const apiKeys = [{ id: "key-1", key: "sk-other", name: "Other Key" }];
    const details = [{ id: "d-2", model: "claude-3-5-sonnet", apiKey: rawKey }];

    const [enriched] = enrichDetails(details, apiKeys);
    expect(enriched.apiKeyName).toBeNull();
    expect(enriched.apiKey).toBe(rawKey.slice(0, 8) + "***" + rawKey.slice(-4));
  });

  it("enriches requests without apiKey as Local / No Key", () => {
    const apiKeys = [{ id: "key-1", key: "sk-key", name: "Key" }];
    const details = [{ id: "d-3", model: "gpt-4o", apiKey: null }];

    const [enriched] = enrichDetails(details, apiKeys);
    expect(enriched.apiKeyName).toBe("Local / No Key");
    expect(enriched.apiKey).toBeNull();
  });
});
