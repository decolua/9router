// REAL matrix test: every active provider in DB x every inbound client format x 4 scenarios.
// Goal: maximize translation-path coverage to surface real bugs (system, multimodal image,
// tool-call/tool-result, reasoning) across all source formats.
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/all-formats.real.test.js
//   RUN_REAL=1 REAL_PROVIDERS=gemini,kiro,codex npx vitest run ... (optional filter)
//
// Skips (console.warn + pass) when: no credential/model, auth/quota status (401/402/403/429),
// or the model rejects a capability (e.g. image on a non-vision model).
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { getModelsByProviderId } from "../../../open-sse/config/providerModels.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const TIMEOUT_MS = 90000;
const CRED_ISSUE = [401, 402, 403, 429];
// Account/plan/capability rejections -> skip (not a translate bug). Kept specific to avoid masking real bugs.
const SKIP_MSG_RE = /image|multimodal|vision|modality|unsupported|not support|reasoning_effort|deprecated|temperature|subscription|valid.*plan|embedding|quota|insufficient|model not found|context length|organization policy|disallowed|allowedmodels|failed_precondition/i;

const PROVIDER_FILTER = (process.env.REAL_PROVIDERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Tiny 1x1 transparent PNG (data URI body + raw base64) for multimodal scenarios.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URI = `data:image/png;base64,${PNG_B64}`;

// Pick first chat LLM, excluding non-chat kinds (embedding/image/tts/stt/...).
const NON_CHAT_KINDS = new Set(["embedding", "image", "imageToText", "tts", "stt", "video", "music", "webSearch"]);
function firstLlmModel(providerId) {
  const models = getModelsByProviderId(providerId);
  const llm = models.find((m) => {
    const kind = m.kind || m.type || "llm";
    return kind === "llm" || (!NON_CHAT_KINDS.has(kind) && kind === "llm");
  }) || models.find((m) => !NON_CHAT_KINDS.has(m.kind || m.type || "llm"));
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

async function prepare(providerId) {
  const model = firstLlmModel(providerId);
  if (!model) return null;
  const credentials = await getProviderCredentials(providerId, new Set(), model);
  if (!credentials || credentials.allRateLimited) return null;
  const refreshed = await checkAndRefreshToken(providerId, credentials);
  return { model, credentials, refreshed };
}

// Run one request. Returns { raw } | "skip" | throws (real translate/runtime bug).
async function runChat(providerId, prep, body, sourceFormatOverride) {
  const result = await handleChatCore({
    body: { ...body, model: `${providerId}/${prep.model}` },
    modelInfo: { provider: providerId, model: prep.model },
    credentials: prep.refreshed,
    connectionId: prep.credentials.connectionId,
    sourceFormatOverride,
  });
  if (!result.success) {
    const status = Number(result.status);
    if (CRED_ISSUE.includes(status)) return "skip";
    // Upstream 5xx and 406 are provider-side issues, not translate bugs.
    if (status >= 500 || status === 406) return "skip";
    // Account/plan/capability rejection (e.g. non-vision model + image) is not a translate bug.
    if (status === 400 && SKIP_MSG_RE.test(String(result.error || ""))) return "skip";
    throw new Error(`${providerId} [${result.status}]: ${result.error}`);
  }
  return { raw: await drainSSE(result.response) };
}

// SSE validity marker per inbound format (response is re-encoded back to source format).
const SSE_MARKER = {
  openai: /chat\.completion\.chunk|"delta"|\[DONE\]/,
  "openai-responses": /response\.|"type"\s*:\s*"response|\[DONE\]/,
  claude: /event:\s*\w|"type"\s*:\s*"(message_start|content_block|message_delta)"/,
  gemini: /"candidates"|"content"|data:/,
  "gemini-cli": /"candidates"|"content"|data:/,
  antigravity: /"candidates"|"content"|data:/,
};

// ---- Body builders: per format x scenario (full, spec-correct shapes) ----

const COMMON = { temperature: 0.3, top_p: 0.9, max_tokens: 256 };
// Reasoning models often reject custom temperature (must be default/1) -> omit sampling.
const REASON_TOK = { max_tokens: 1024 };

// OpenAI Chat Completions
const openaiBody = {
  basic: () => ({
    ...COMMON, stream: true, stream_options: { include_usage: true },
    messages: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "Reply with the single word: hi" },
    ],
  }),
  multimodal: () => ({
    ...COMMON, stream: true,
    messages: [
      { role: "system", content: "Describe images briefly." },
      { role: "user", content: [
        { type: "text", text: "What color dominates this image? One word." },
        { type: "image_url", image_url: { url: PNG_DATA_URI } },
      ] },
    ],
  }),
  tools: () => ({
    ...COMMON, stream: true, tool_choice: "auto",
    tools: [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }],
    messages: [
      { role: "user", content: "Weather in Paris?" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: '{"temp":"20C"}' },
      { role: "user", content: "Summarize in one short sentence." },
    ],
  }),
  reasoning: () => ({
    ...REASON_TOK, stream: true, reasoning_effort: "low",
    messages: [{ role: "user", content: "What is 17 + 26? Reply with just the number." }],
  }),
};

// OpenAI Responses API
const responsesBody = {
  basic: () => ({
    ...COMMON, stream: true, max_output_tokens: 256,
    instructions: "You are concise.",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with the single word: hi" }] }],
  }),
  multimodal: () => ({
    ...COMMON, stream: true, max_output_tokens: 256,
    instructions: "Describe images briefly.",
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: "What color dominates? One word." },
      { type: "input_image", image_url: PNG_DATA_URI },
    ] }],
  }),
  tools: () => ({
    ...COMMON, stream: true,
    tools: [{ type: "function", name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Weather in Paris?" }] },
      { type: "function_call", call_id: "call_1", name: "get_weather", arguments: '{"city":"Paris"}' },
      { type: "function_call_output", call_id: "call_1", output: '{"temp":"20C"}' },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Summarize in one short sentence." }] },
    ],
  }),
  reasoning: () => ({
    ...REASON_TOK, stream: true, max_output_tokens: 1024, reasoning: { effort: "low" },
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "What is 17 + 26? Just the number." }] }],
  }),
};

// Anthropic Messages (Claude)
const claudeBody = {
  basic: () => ({
    ...COMMON, stream: true,
    system: [{ type: "text", text: "You are concise." }],
    messages: [{ role: "user", content: "Reply with the single word: hi" }],
  }),
  multimodal: () => ({
    ...COMMON, stream: true,
    system: [{ type: "text", text: "Describe images briefly." }],
    messages: [{ role: "user", content: [
      { type: "text", text: "What color dominates? One word." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } },
    ] }],
  }),
  tools: () => ({
    ...COMMON, stream: true,
    tools: [{ name: "get_weather", description: "Get weather", input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
    messages: [
      { role: "user", content: "Weather in Paris?" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"temp":"20C"}' }] },
      { role: "user", content: "Summarize in one short sentence." },
    ],
  }),
  reasoning: () => ({
    ...REASON_TOK, stream: true, thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [{ role: "user", content: "What is 17 + 26? Just the number." }],
  }),
};

// Gemini generateContent
const geminiBody = {
  basic: () => ({
    systemInstruction: { parts: [{ text: "You are concise." }] },
    contents: [{ role: "user", parts: [{ text: "Reply with the single word: hi" }] }],
    generationConfig: { maxOutputTokens: 256, temperature: 0.3, topP: 0.9 },
  }),
  multimodal: () => ({
    systemInstruction: { parts: [{ text: "Describe images briefly." }] },
    contents: [{ role: "user", parts: [
      { text: "What color dominates? One word." },
      { inlineData: { mimeType: "image/png", data: PNG_B64 } },
    ] }],
    generationConfig: { maxOutputTokens: 256 },
  }),
  tools: () => ({
    tools: [{ functionDeclarations: [{ name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }] }],
    contents: [
      { role: "user", parts: [{ text: "Weather in Paris?" }] },
      { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Paris" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { temp: "20C" } } }] },
      { role: "user", parts: [{ text: "Summarize in one short sentence." }] },
    ],
    generationConfig: { maxOutputTokens: 256 },
  }),
  reasoning: () => ({
    contents: [{ role: "user", parts: [{ text: "What is 17 + 26? Just the number." }] }],
    generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 512, includeThoughts: true } },
  }),
};

// Antigravity = Gemini body wrapped in { request, userAgent }.
const wrapAntigravity = (fn) => () => ({ request: fn(), userAgent: "antigravity" });
const antigravityBody = {
  basic: wrapAntigravity(geminiBody.basic),
  multimodal: wrapAntigravity(geminiBody.multimodal),
  tools: wrapAntigravity(geminiBody.tools),
  reasoning: wrapAntigravity(geminiBody.reasoning),
};

const BUILDERS = {
  openai: openaiBody,
  "openai-responses": responsesBody,
  claude: claudeBody,
  gemini: geminiBody,
  "gemini-cli": geminiBody,
  antigravity: antigravityBody,
};

const FORMATS = Object.keys(BUILDERS);
const SCENARIOS = ["basic", "multimodal", "tools", "reasoning"];

// Read active providers from DB at module-eval time (one test per provider/format/scenario).
function targetProviders() {
  try {
    const Database = require("better-sqlite3");
    const os = require("os");
    const path = require("path");
    const dbPath = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, "db", "data.sqlite")
      : path.join(os.homedir(), ".9router", "db", "data.sqlite");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT DISTINCT provider FROM providerConnections WHERE isActive = 1").all();
    db.close();
    let list = rows.map((r) => r.provider).sort();
    if (PROVIDER_FILTER.length) list = list.filter((p) => PROVIDER_FILTER.includes(p));
    return list;
  } catch {
    return [];
  }
}

describe.skipIf(!RUN_REAL)("REAL all-formats matrix", () => {
  const providers = RUN_REAL ? targetProviders() : [];

  it("has active providers in DB", () => {
    expect(providers.length).toBeGreaterThan(0);
  });

  for (const providerId of providers) {
    for (const fmt of FORMATS) {
      for (const scn of SCENARIOS) {
        it.concurrent(`${providerId} | ${fmt} | ${scn}`, async () => {
          const prep = await prepare(providerId);
          if (!prep) { console.warn(`[skip] ${providerId}: no cred/model`); return expect(true).toBe(true); }

          const body = BUILDERS[fmt][scn]();
          const out = await runChat(providerId, prep, body, fmt);
          if (out === "skip") { console.warn(`[skip] ${providerId} ${fmt}/${scn}: cred/quota/capability`); return expect(true).toBe(true); }

          expect(out.raw.length, `${providerId} ${fmt}/${scn}: empty SSE`).toBeGreaterThan(0);
          expect(SSE_MARKER[fmt].test(out.raw), `${providerId} ${fmt}/${scn}: invalid SSE shape`).toBe(true);
        }, TIMEOUT_MS);
      }
    }
  }
});
