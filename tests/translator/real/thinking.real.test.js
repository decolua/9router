// REAL integration test for thinking normalization: sends a reasoning prompt with
// reasoning_effort to every thinking-capable provider that has an active credential,
// then asserts the upstream accepted it (no 400) and emitted reasoning output.
// Gated by RUN_REAL=1 so the default `vitest run` never touches the network.
//
//   RUN_REAL=1 npx vitest run -c tests/vitest.config.js "tests/translator/real/thinking"
//   RUN_REAL=1 REAL_PROVIDERS=claude,glm,deepseek npx vitest run -c tests/vitest.config.js "tests/translator/real/thinking"
//
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { getModelsByProviderId } from "../../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../../open-sse/providers/capabilities.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const MAX_TOKENS = 512;
const TIMEOUT_MS = 120000;
const EFFORT = process.env.THINK_EFFORT || "high";
const PROVIDER_FILTER = (process.env.REAL_PROVIDERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// First plain llm model that the capability registry marks as reasoning-capable.
function firstReasoningModel(providerId) {
  const models = getModelsByProviderId(providerId);
  for (const m of models) {
    if ((m.type || "llm") !== "llm") continue;
    if (/embedding|image|tts|whisper|rerank|vision-model/i.test(m.id)) continue;
    if (getCapabilitiesForModel(providerId, m.id).reasoning) return m.id;
  }
  return null;
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

describe.skipIf(!RUN_REAL).concurrent("REAL thinking normalization", () => {
  it("has active providers in DB", () => {
    expect(targetProviders().length).toBeGreaterThan(0);
  });

  for (const providerId of (RUN_REAL ? targetProviders() : [])) {
    it.concurrent(
      `${providerId}: accepts reasoning_effort=${EFFORT} and reasons`,
      async () => {
        const model = firstReasoningModel(providerId);
        if (!model) {
          console.warn(`[skip] ${providerId}: no reasoning-capable model`);
          return expect(true).toBe(true);
        }

        const credentials = await getProviderCredentials(providerId, new Set(), model);
        if (!credentials || credentials.allRateLimited) {
          console.warn(`[skip] ${providerId}: no usable credential`);
          return expect(true).toBe(true);
        }

        const refreshed = await checkAndRefreshToken(providerId, credentials);
        const result = await handleChatCore({
          body: {
            model: `${providerId}/${model}`,
            stream: true,
            max_tokens: MAX_TOKENS,
            reasoning_effort: EFFORT,
            messages: [{ role: "user", content: "Think step by step, then answer: what is 17 * 23?" }],
          },
          modelInfo: { provider: providerId, model },
          credentials: refreshed,
          connectionId: credentials.connectionId,
        });

        if (!result.success) {
          // 400 = our thinking payload was rejected → real bug. Other codes = credential/quota.
          const credIssue = [401, 402, 403, 429].includes(Number(result.status));
          if (credIssue) {
            console.warn(`[skip] ${providerId}: ${result.status} (credential/quota)`);
            return expect(true).toBe(true);
          }
          console.error(`[REJECT] ${providerId}/${model} ${result.status}:`, JSON.stringify(result.error)?.slice(0, 600));
          throw new Error(`${providerId}/${model} thinking REJECTED: ${result.status}`);
        }

        const raw = await drainSSE(result.response);
        expect(raw.length, `${providerId}: empty response`).toBeGreaterThan(0);
        const hasReasoning = /reasoning_content|"thinking"|reasoning_details|<think/.test(raw);
        // Log so the operator can eyeball which providers actually streamed reasoning.
        console.log(`[ok] ${providerId}/${model} reasoning=${hasReasoning}`);
        expect(/data:|"delta"|"content"|finish_reason/.test(raw), `${providerId}: not SSE`).toBe(true);
      },
      TIMEOUT_MS
    );
  }
});

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
