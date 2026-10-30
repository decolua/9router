import { describe, it, expect } from "vitest";
import { PROVIDERS } from "open-sse/config/providers.js";
import { getExecutor } from "open-sse/executors/index.js";

// The CodeBuddy gateways (CN + intl) run a per-request channel check. Without
// the official plugin's request/conversation identifiers upstream rejects the
// call with 400 / 11128 "request illegal" ("failed channel verification").
// These tests lock the header wiring so the ids cannot silently disappear.
const REQUIRED = [
  "X-Request-ID",
  "X-Conversation-ID",
  "X-Conversation-Request-ID",
  "X-Root-Request-ID",
  "X-Conversation-Message-ID",
];

const CREDS = { accessToken: "TESTTOKEN", apiKey: null };
const API_KEY_CREDS = { accessToken: null, apiKey: "  ck_test_key_1234567890abcdef29s\n" };

function buildHeaders(id, creds = CREDS, body = {}) {
  const executor = getExecutor(id);
  return executor.buildHeaders({ ...creds }, true, PROVIDERS[id].baseUrl, "deepseek-v4.1-flash", body);
}

describe("codebuddy channel headers", () => {
  for (const id of ["codebuddy-intl", "codebuddy-cn"]) {
    describe(id, () => {
      it("registers the codebuddyHeaders hook", () => {
        expect(PROVIDERS[id]?.auth?.hooks).toContain("codebuddyHeaders");
      });

      it("sends the plugin request/conversation ids", () => {
        const headers = buildHeaders(id);
        for (const key of REQUIRED) {
          expect(typeof headers[key], `${id} must send ${key}`).toBe("string");
          expect(headers[key].length).toBeGreaterThan(0);
        }
      });

      it("reuses one request id across the request/conversation pair", () => {
        const headers = buildHeaders(id);
        expect(headers["X-Request-ID"]).toBe(headers["X-Conversation-Request-ID"]);
        expect(headers["X-Root-Request-ID"]).toBe(headers["X-Conversation-Request-ID"]);
        expect(headers["X-Conversation-ID"]).not.toBe(headers["X-Conversation-Message-ID"]);
      });

      it("reuses caller session_id / conversation_id / prompt_cache_key as X-Conversation-ID", () => {
        const h1 = buildHeaders(id, CREDS, { session_id: "sess-stable-123" });
        const h2 = buildHeaders(id, CREDS, { conversation_id: "conv-stable-456" });
        const h3 = buildHeaders(id, CREDS, { prompt_cache_key: "cache-stable-789" });
        expect(h1["X-Conversation-ID"]).toBe("sess-stable-123");
        expect(h2["X-Conversation-ID"]).toBe("conv-stable-456");
        expect(h3["X-Conversation-ID"]).toBe("cache-stable-789");
      });

      it("still applies the bearer token after the hook runs", () => {
        const h = buildHeaders(id);
        expect(h.Authorization).toBe("Bearer TESTTOKEN");
        expect(h["X-API-Key"]).toBeUndefined();
      });

      it("sends dual auth (Bearer + X-API-Key), anonymous_<last8> X-User-Id, and WorkBuddy 5.9.3 headers in API key mode", () => {
        const h = buildHeaders(id, API_KEY_CREDS, { session_id: "sess-key-01" });
        expect(h.Authorization).toBe("Bearer ck_test_key_1234567890abcdef29s");
        expect(h["X-API-Key"]).toBe("ck_test_key_1234567890abcdef29s");
        expect(h["X-User-Id"]).toBe("anonymous_bcdef29s");
        expect(h["X-Domain"]).toBeUndefined();
        expect(h["X-IDE-Type"]).toBe("WorkBuddy");
        expect(h["X-IDE-Name"]).toBe("WorkBuddy");
        expect(h["X-IDE-Version"]).toBe("5.9.3");
        expect(h["X-Agent-Intent"]).toBe("craft");
        expect(h["X-Agent-Purpose"]).toBe("conversation");
        expect(h["X-Agent-Type"]).toBe("main");
        expect(h["X-Agent-Runtime"]).toBe("local-agent");
        expect(h["X-Conversation-ID"]).toBe("sess-key-01");
        expect(h["User-Agent"]).toBe(
          id === "codebuddy-intl"
            ? "WorkBuddy/5.9.3 workbuddy-ai/5.9.3 CLI/2.165.0"
            : "WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/2.165.0"
        );
      });

      it("issues fresh ids per request", () => {
        const a = buildHeaders(id);
        const b = buildHeaders(id);
        expect(a["X-Request-ID"]).not.toBe(b["X-Request-ID"]);
        expect(a["X-Conversation-ID"]).not.toBe(b["X-Conversation-ID"]);
      });
    });
  }
});
