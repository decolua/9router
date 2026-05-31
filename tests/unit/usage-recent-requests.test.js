import { describe, expect, it, vi } from "vitest";

// usageRepo pulls in the DB driver chain (driver → paths → @/lib/dataDir.js) at
// import time; vitest has no `@` alias config (only jsconfig paths), so stub the
// driver to keep these pure-function tests self-contained.
vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({ all: vi.fn(() => []), get: vi.fn(), run: vi.fn() })),
}));

const {
  formatRecentRequest,
  resolveRecentRequestApiKey,
} = await import("../../src/lib/db/repos/usageRepo.js");

describe("usage recent request API key metadata", () => {
  it("labels local requests without an API key", () => {
    expect(resolveRecentRequestApiKey(null)).toEqual({
      apiKeyId: "local-no-key",
      keyName: "Local",
    });
  });

  it("uses the configured API key name + stable id, never the secret", () => {
    const result = resolveRecentRequestApiKey("sk-test-1234567890", {
      "sk-test-1234567890": { id: "key-1", name: "Claude Desktop" },
    });

    expect(result).toEqual({
      apiKeyId: "key-1",
      keyName: "Claude Desktop",
    });
    // Security (#1258): the plaintext key must never appear in the payload.
    expect(JSON.stringify(result)).not.toContain("sk-test-1234567890");
  });

  it("falls back to a masked ••••last4 label for unknown API keys", () => {
    const result = resolveRecentRequestApiKey("sk-unknown-abcdef");
    expect(result).toEqual({
      apiKeyId: "••••cdef",
      keyName: "••••cdef",
    });
    expect(JSON.stringify(result)).not.toContain("sk-unknown-abcdef");
  });

  it("formats recent request token counts with key display metadata, no secret", () => {
    const result = formatRecentRequest(
      {
        timestamp: "2026-05-18T20:00:00.000Z",
        provider: "openai",
        model: "gpt-5",
        apiKey: "sk-test-1234567890",
        tokens: { input_tokens: 12, output_tokens: 34 },
        status: "success",
      },
      { "sk-test-1234567890": { id: "key-1", name: "Agent CLI" } },
    );

    expect(result).toMatchObject({
      model: "gpt-5",
      provider: "openai",
      promptTokens: 12,
      completionTokens: 34,
      status: "success",
      apiKeyId: "key-1",
      keyName: "Agent CLI",
    });
    // The secret key value is never carried in the formatted request.
    expect(result).not.toHaveProperty("apiKey");
    expect(JSON.stringify(result)).not.toContain("sk-test-1234567890");
  });
});
