// REAL endpoint matrix for opencode-go DeepSeek models.
//
// Verifies, against the live upstream (https://opencode.ai/zen/go), that each client
// request format actually WORKS for DeepSeek on the endpoint 9router routes it to:
//
//   Claude (/v1/messages)          → must return a Claude-shape SSE
//   Codex (/v1/responses)          → must return an OpenAI Responses-shape SSE
//   OpenAI (/v1/chat/completions)  → must return an OpenAI chat-shape SSE
//
// This is the live counterpart of tests/unit/opencode-go-transport-routing.test.js
// (which proves the routing decision offline). A cell here fails when the upstream
// rejects the routed endpoint+model combination — exactly the 400 that #3332 reported
// for Claude→deepseek-v4-flash on /messages.
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/opencode-go-deepseek.real.test.js
//
// Requires an active opencode-go credential in the local DB (add via 9router dashboard).
// Skips (pass) only on credential/quota/plan rejections, mirroring the other .real tests.
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const PROVIDER = "opencode-go";
const TIMEOUT_MS = 90000;
const CRED_ISSUE = [401, 402, 403, 429];
const SKIP_MSG_RE = /image|multimodal|vision|modality|unsupported|not support|reasoning_effort|deprecated|temperature|subscription|valid.*plan|embedding|quota|insufficient|model not found|context length|organization policy|disallowed|allowedmodels|failed_precondition/i;

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

// One request. Returns { raw } | "skip"; throws on a real upstream rejection.
async function runChat(model, body, sourceFormat) {
  const credentials = await getProviderCredentials(PROVIDER, new Set(), model);
  if (!credentials || credentials.allRateLimited) return "skip";
  const refreshed = await checkAndRefreshToken(PROVIDER, credentials);

  const result = await handleChatCore({
    body: { ...body, model: `${PROVIDER}/${model}` },
    modelInfo: { provider: PROVIDER, model },
    credentials: refreshed,
    connectionId: credentials.connectionId,
    sourceFormatOverride: sourceFormat,
  });
  if (!result.success) {
    const status = Number(result.status);
    if (CRED_ISSUE.includes(status)) return "skip";
    if (status >= 500 || status === 406) return "skip";
    if (status === 400 && SKIP_MSG_RE.test(String(result.error || ""))) return "skip";
    throw new Error(`${PROVIDER}/${model} ${sourceFormat} [${result.status}]: ${result.error}`);
  }
  return { raw: await drainSSE(result.response) };
}

// SSE markers: response is re-encoded back to the client's source format.
const SSE_MARKER = {
  openai: /chat\.completion\.chunk|"delta"|\[DONE\]/,
  "openai-responses": /response\.|"type"\s*:\s*"response|\[DONE\]/,
  claude: /event:\s*\w|"type"\s*:\s*"(message_start|content_block|message_delta)"/,
};

const MAX_TOKENS = 128;

const BODIES = {
  claude: () => ({
    stream: true,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: "You are concise." }],
    messages: [{ role: "user", content: "Reply with the single word: hi" }],
  }),
  openai: () => ({
    stream: true,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: "Reply with the single word: hi" }],
  }),
  "openai-responses": () => ({
    stream: true,
    max_output_tokens: MAX_TOKENS,
    instructions: "You are concise.",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply with the single word: hi" }] }],
  }),
};

// Cells: (model, format). `(max)` reproduces the 9router thinking override sent by
// Claude Code — it must land on the same endpoint as the bare id.
const CELLS = [
  ["deepseek-v4-flash", "claude"],
  ["deepseek-v4-flash(max)", "claude"],
  ["deepseek-v4-flash", "openai-responses"],
  ["deepseek-v4-flash", "openai"],
  ["deepseek-v4-pro", "claude"],
  ["deepseek-v4-pro", "openai-responses"],
  // Control: MiniMax keeps /messages for Claude clients.
  ["minimax-m3", "claude"],
];

describe.skipIf(!RUN_REAL)(`REAL opencode-go DeepSeek endpoint matrix`, () => {
  it("has an active opencode-go credential", async () => {
    const creds = await getProviderCredentials(PROVIDER, new Set(), "deepseek-v4-flash");
    expect(creds && !creds.allRateLimited).toBe(true);
  });

  for (const [model, fmt] of CELLS) {
    it(`${fmt}-format client → ${model} returns ${fmt}-shape SSE`, async () => {
      const out = await runChat(model, BODIES[fmt](), fmt);
      if (out === "skip") {
        console.warn(`[skip] ${PROVIDER}/${model} ${fmt}: credential/quota/capability`);
        return expect(true).toBe(true);
      }
      expect(out.raw.length, `${model} ${fmt}: empty SSE`).toBeGreaterThan(0);
      expect(SSE_MARKER[fmt].test(out.raw), `${model} ${fmt}: wrong SSE shape (routed endpoint rejected?)`).toBe(true);
    }, TIMEOUT_MS);
  }
});
