import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

/**
 * Guards fix for issue #2311:
 * The OpenAI Responses API → Chat Completions translator was forwarding
 * `client_metadata` (and other Responses-API-only fields) to upstream
 * providers. NVIDIA NIM rejects such fields with:
 *   "Validation: Unsupported parameter(s): `client_metadata`" (400)
 *
 * Fix: delete client_metadata, background, and truncation in the cleanup
 * phase of openaiResponsesToOpenAIRequest.
 */
describe("openaiResponsesToOpenAIRequest — strips Responses-API-only fields", () => {
  const baseBody = {
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    model: "gpt-4o",
    client_metadata: { caller: "codex-cli", version: "0.5.15" },
    background: false,
    truncation: "auto",
    store: true,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: "abc123",
  };

  it("strips client_metadata from the forwarded body", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("client_metadata");
  });

  it("strips background from the forwarded body", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("background");
  });

  it("strips truncation from the forwarded body", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("truncation");
  });

  it("also strips the already-handled fields (input, store, include, prompt_cache_key)", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(result).not.toHaveProperty("input");
    expect(result).not.toHaveProperty("store");
    expect(result).not.toHaveProperty("include");
    expect(result).not.toHaveProperty("prompt_cache_key");
  });

  it("preserves the converted messages content", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-4o", baseBody, false, {});
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.some(m => m.role === "user")).toBe(true);
  });

  it("does not strip unrelated fields like temperature or max_tokens", () => {
    const bodyWithExtra = {
      ...baseBody,
      temperature: 0.7,
      max_tokens: 512,
    };
    const result = openaiResponsesToOpenAIRequest("gpt-4o", bodyWithExtra, false, {});
    // temperature and max_tokens are passed through (not Responses-API-only)
    // We can't assert they ARE present since the translator may not copy them,
    // but we assert they are not erroneously deleted when they exist.
    if ("temperature" in bodyWithExtra) {
      expect(result.temperature).toBe(0.7);
    }
  });
});
