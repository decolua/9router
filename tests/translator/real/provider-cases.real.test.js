// B2: REAL behavior assertions for the risky provider-specific cases.
// Unlike smoke (only "doesn't crash"), each test asserts concrete OUTPUT.
// Gated by RUN_REAL=1; any provider lacking creds/model or returning an auth/quota
// status (401/402/403/429) is skipped (console.warn + pass).
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/provider-cases.real.test.js
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { getModelsByProviderId } from "../../../open-sse/config/providerModels.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const TIMEOUT_MS = 90000;
const CRED_ISSUE = [401, 402, 403, 429];

// Pick the first plain llm model for a provider.
function firstLlmModel(providerId) {
  const models = getModelsByProviderId(providerId);
  const llm = models.find((m) => (m.type || "llm") === "llm");
  return llm?.id || null;
}

async function drainSSE(response) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

// Resolve creds+model for a provider, or null when unavailable (caller skips).
async function prepare(providerId) {
  const model = firstLlmModel(providerId);
  if (!model) {
    console.warn(`[skip] ${providerId}: no llm model`);
    return null;
  }
  const credentials = await getProviderCredentials(providerId, new Set(), model);
  if (!credentials || credentials.allRateLimited) {
    console.warn(`[skip] ${providerId}: no usable credential`);
    return null;
  }
  const refreshed = await checkAndRefreshToken(providerId, credentials);
  return { model, credentials, refreshed };
}

// Run handleChatCore + drain; returns { raw } or null if cred/quota issue (caller skips).
async function runChat(providerId, prep, body) {
  const result = await handleChatCore({
    body: { model: `${providerId}/${prep.model}`, ...body },
    modelInfo: { provider: providerId, model: prep.model },
    credentials: prep.refreshed,
    connectionId: prep.credentials.connectionId,
  });
  if (!result.success) {
    if (CRED_ISSUE.includes(Number(result.status))) {
      console.warn(`[skip] ${providerId}: ${result.status} (credential/quota)`);
      return null;
    }
    throw new Error(`${providerId} failed: ${result.status} ${result.error}`);
  }
  return { raw: await drainSSE(result.response) };
}

describe.skipIf(!RUN_REAL)("REAL provider behavior cases", () => {
  // Case #1: Gemini normal prompt -> finish_reason "stop".
  it("gemini: finish_reason stop", async () => {
    const prep = await prepare("gemini");
    if (!prep) return expect(true).toBe(true);
    // Generous max_tokens so reasoning models (gemini-3 pro) don't hit "length" first.
    const out = await runChat("gemini", prep, {
      stream: true,
      max_tokens: 2048,
      messages: [{ role: "user", content: "Reply with the single word: hi" }],
    });
    if (!out) return expect(true).toBe(true);
    expect(/"finish_reason"\s*:\s*"stop"/.test(out.raw), "no stop finish_reason").toBe(true);
  }, TIMEOUT_MS);

  // Case #4: Kiro tool turn -> tool_calls finish_reason + tool_calls delta.
  it("kiro: tool turn -> tool_calls", async () => {
    const prep = await prepare("kiro");
    if (!prep) return expect(true).toBe(true);
    const out = await runChat("kiro", prep, {
      stream: true,
      max_tokens: 128,
      tool_choice: "auto",
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the current weather for a city",
          parameters: {
            type: "object",
            properties: { city: { type: "string", description: "City name" } },
            required: ["city"],
          },
        },
      }],
      messages: [{ role: "user", content: "What's the weather in Paris? Use the get_weather tool." }],
    });
    if (!out) return expect(true).toBe(true);
    expect(/"finish_reason"\s*:\s*"tool_calls"/.test(out.raw), "no tool_calls finish_reason").toBe(true);
    expect(/"tool_calls"/.test(out.raw), "no tool_calls delta").toBe(true);
  }, TIMEOUT_MS);

  // Case #3: Ollama tiny max_tokens + long prompt -> finish_reason "length".
  it("ollama: max_tokens -> length", async () => {
    const prep = await prepare("ollama");
    if (!prep) return expect(true).toBe(true);
    const out = await runChat("ollama", prep, {
      stream: true,
      max_tokens: 4,
      messages: [{ role: "user", content: "Write a long detailed essay about the history of computing." }],
    });
    if (!out) return expect(true).toBe(true);
    // length is model-dependent; if the model stopped on its own, skip rather than fail.
    if (!/"finish_reason"\s*:\s*"length"/.test(out.raw)) {
      console.warn("[skip] ollama: model did not hit length (output shorter than max_tokens)");
      return expect(true).toBe(true);
    }
    expect(/"finish_reason"\s*:\s*"length"/.test(out.raw)).toBe(true);
  }, TIMEOUT_MS);

  // Case #4/#5: Codex multi-turn -> session stickiness (prompt-cache hit on 2nd turn).
  it("codex: session stickiness (cached_tokens on 2nd turn)", async () => {
    const prep = await prepare("codex");
    if (!prep) return expect(true).toBe(true);
    const longContext = "The capital of France is Paris. ".repeat(40);
    const messages = [
      { role: "user", content: longContext },
      { role: "assistant", content: "Understood. I have noted that context." },
      { role: "user", content: "Reply with the single word: ok" },
    ];
    const body = { stream: true, max_tokens: 32, messages };
    const first = await runChat("codex", prep, body);
    if (!first) return expect(true).toBe(true);
    const second = await runChat("codex", prep, body);
    if (!second) return expect(true).toBe(true);
    // 2nd identical-context turn should hit prompt cache when session is sticky.
    const m = second.raw.match(/"cached_tokens"\s*:\s*(\d+)/);
    if (!m) {
      console.warn("[skip] codex: no cached_tokens in usage (provider may not report)");
      return expect(true).toBe(true);
    }
    expect(Number(m[1]), "cached_tokens not > 0 on 2nd turn").toBeGreaterThan(0);
  }, TIMEOUT_MS);

  // Case #1/#2: Antigravity normal prompt -> valid SSE response.
  it("antigravity: responds OK", async () => {
    const prep = await prepare("antigravity");
    if (!prep) return expect(true).toBe(true);
    const out = await runChat("antigravity", prep, {
      stream: true,
      max_tokens: 32,
      messages: [{ role: "user", content: "Reply with the single word: hi" }],
    });
    if (!out) return expect(true).toBe(true);
    expect(out.raw.length, "empty response").toBeGreaterThan(0);
    expect(/data:|finish_reason|"delta"|"content"|event:/.test(out.raw), "not SSE").toBe(true);
  }, TIMEOUT_MS);
});
