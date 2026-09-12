// Live Zed Hosted AI smoke: catalog + one short completion.
// Gated by RUN_REAL=1. Uses the active Zed connection from ~/.9router.
//
//   RUN_REAL=1 npx vitest run translator/real/zed.real.test.js
import { describe, it, expect } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { resolveZedModels } from "../../../open-sse/shared/zedAuth.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const TIMEOUT_MS = 90000;

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

describe.skipIf(!RUN_REAL)("REAL Zed Hosted AI", () => {
  it(
    "lists live models and completes a short prompt",
    async () => {
      const credentials = await getProviderCredentials("zed");
      if (!credentials?.accessToken || credentials.allRateLimited) {
        console.warn("[skip] zed: no usable credential");
        return expect(true).toBe(true);
      }

      const catalog = await resolveZedModels(credentials, { forceRefresh: true }).catch((err) => {
        if (Number(err?.status) === 401 || /unauthorized/i.test(String(err?.message))) {
          return { models: [], warning: "Zed credential unauthorized — reconnect the account" };
        }
        throw err;
      });

      if (catalog?.warning) console.warn(`[zed catalog] ${catalog.warning}`);
      if (!catalog?.models?.length) {
        console.warn("[skip] zed: empty catalog or unauthorized");
        return expect(true).toBe(true);
      }

      const model = catalog.defaultModel || catalog.models[0].id;
      console.log(`[zed] using model ${model} (${catalog.models.length} live)`);

      const result = await handleChatCore({
        body: {
          model: `zed/${model}`,
          stream: true,
          max_tokens: 32,
          messages: [{ role: "user", content: "Reply with the single word: hi" }],
        },
        modelInfo: { provider: "zed", model },
        credentials,
        connectionId: credentials.connectionId || credentials.id,
      });

      if (!result.success) {
        const credIssue = [401, 402, 403, 429].includes(Number(result.status));
        if (credIssue) {
          console.warn(`[skip] zed: ${result.status} (credential/quota)`);
          return expect(true).toBe(true);
        }
        throw new Error(`zed failed: ${result.status} ${result.error}`);
      }

      const raw = await drainSSE(result.response);
      expect(raw.length, "empty Zed SSE").toBeGreaterThan(0);
      expect(/data:|finish_reason|"delta"|"content"/.test(raw), "not SSE").toBe(true);
    },
    TIMEOUT_MS,
  );
});
