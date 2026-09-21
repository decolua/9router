import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import http from "node:http";
import crypto from "node:crypto";

import {
  generateAuthData,
  exchangeTokens,
} from "../../src/lib/oauth/providers/index.js";
import orcarouter from "../../src/lib/oauth/providers/orcarouter.js";
import { generateCodeChallenge } from "../../src/lib/oauth/utils/pkce.js";
import {
  ORCAROUTER_ID,
  ORCAROUTER_AUTH_BASE_DEFAULT,
  ORCAROUTER_API_BASE_DEFAULT,
  discoverOrcaRouterModels,
  normalizeCatalogEntry,
  buildCatalogUrl,
} from "../../open-sse/providers/orcarouterCatalog.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import {
  isDurableCredentialProvider,
  durableCredentialReauthFields,
} from "../../open-sse/services/accountFallback.js";

const AUTH_ORIGIN = new URL(ORCAROUTER_AUTH_BASE_DEFAULT).origin;
const API_ORIGIN = new URL(ORCAROUTER_API_BASE_DEFAULT).origin;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ORCA_AUTH_BASE_URL;
  delete process.env.ORCA_BASE_URL;
  delete process.env.ORCA_API_BASE_URL;
});

/**
 * The seam both adapters sit on: acquiring an OrcaRouter credential. The
 * API-key adapter is this function; the PKCE adapter is a connect flow that
 * ends by producing the same shape.
 */
async function apiKeyAdapter({ apiKey, name = "OrcaRouter API Key" }) {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) throw new Error("API key is required");
  // Matches POST /api/providers for a dual-auth provider: authType "apikey".
  return {
    provider: ORCAROUTER_ID,
    authType: "apikey",
    name,
    apiKey: trimmed,
    credential: trimmed,
  };
}

/** The PKCE adapter: full authorize → code → exchange → credential. */
async function pkceAdapter({ authBase }) {
  void authBase;
  const authData = await generateAuthData(ORCAROUTER_ID, "oob");
  // Record the challenge this attempt presented so the fixture can verify the
  // exchange binds the verifier to it, exactly as the real server does.
  lastChallenge = authData.codeChallenge;
  const mapped = await exchangeTokens(ORCAROUTER_ID, "pasted-code", "oob", authData.codeVerifier, authData.state, {
    meta: {},
  });
  return { provider: ORCAROUTER_ID, authType: "oauth", credential: mapped.accessToken, mapped, authData };
}

/** Ask the real executor what it would send, ignoring how the key was acquired. */
function credentialForInference(connection) {
  const executor = getExecutor(connection.provider);
  const credentials = {
    apiKey: connection.apiKey,
    accessToken: connection.accessToken,
    providerSpecificData: connection.providerSpecificData || {},
  };
  const headers = executor.buildHeaders(credentials, false, null, "openai/gpt-5.5", null);
  return {
    url: executor.buildUrl("openai/gpt-5.5", false, 0, credentials),
    headers,
  };
}

describe("orcarouter dual-auth seam — two adapters, one credential", () => {
  it("is registered as a provider that accepts both auth modes", async () => {
    const { OAUTH_PROVIDERS, AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    // category "oauth" + authModes including "apikey" is what the dashboard uses
    // to render both buttons (hasDualAuthModes).
    expect(OAUTH_PROVIDERS[ORCAROUTER_ID]).toBeTruthy();
    expect(AI_PROVIDERS[ORCAROUTER_ID].authModes).toEqual(["apikey", "oauth"]);
  });

  it("produces the same credential result shape from both adapters", async () => {
    const server = await startFakeAuthServer();
    try {
      process.env.ORCA_AUTH_BASE_URL = server.base;
      const viaKey = await apiKeyAdapter({ apiKey: "sk-orca-pasted" });
      const viaPkce = await pkceAdapter({ authBase: server.base });

      // Both adapters yield exactly one downstream credential, on the same key.
      expect(viaKey.credential).toBe("sk-orca-pasted");
      expect(viaPkce.credential).toBe(server.issuedKey);
      expect(Object.keys(viaKey)).toContain("credential");
      expect(Object.keys(viaPkce)).toContain("credential");
      expect(viaKey.provider).toBe(viaPkce.provider);
    } finally {
      await server.close();
    }
  });

  it("routes both credentials to the same inference endpoint with Bearer auth", async () => {
    const server = await startFakeAuthServer();
    try {
      process.env.ORCA_AUTH_BASE_URL = server.base;
      const viaKey = await apiKeyAdapter({ apiKey: "sk-orca-pasted" });
      const viaPkce = await pkceAdapter({ authBase: server.base });

      const fromKey = credentialForInference({ provider: ORCAROUTER_ID, apiKey: "sk-orca-pasted" });
      const fromPkce = credentialForInference({ provider: ORCAROUTER_ID, accessToken: viaPkce.credential, apiKey: viaPkce.credential });

      // One inference contract, independent of how the key was obtained.
      expect(fromKey.url).toBe("https://api.orcarouter.ai/v1/chat/completions");
      expect(fromPkce.url).toBe(fromKey.url);
      expect(fromKey.headers.Authorization).toBe("Bearer sk-orca-pasted");
      expect(fromPkce.headers.Authorization).toBe(`Bearer ${viaPkce.credential}`);
      expect(new URL(fromPkce.url).origin).toBe(API_ORIGIN);
      expect(new URL(fromKey.url).origin).not.toBe(AUTH_ORIGIN);
    } finally {
      await server.close();
    }
  });

  it("lets model discovery ignore the credential's origin", async () => {
    const server = await startFakeAuthServer();
    try {
      process.env.ORCA_AUTH_BASE_URL = server.base;
      const viaKey = await apiKeyAdapter({ apiKey: "sk-orca-pasted" });
      const viaPkce = await pkceAdapter({ authBase: server.base });

      const seen = [];
      const fetchImpl = async (url, init) => {
        seen.push({ url, auth: init.headers.Authorization });
        return { ok: true, status: 200, body: null, text: async () => JSON.stringify({ data: CATALOG }) };
      };

      const a = await discoverOrcaRouterModels({ apiKey: viaKey.credential, fetchImpl });
      const b = await discoverOrcaRouterModels({ apiKey: viaPkce.credential, fetchImpl });

      // Same catalog request, no knowledge of which adapter produced the key.
      expect(a.models.map((m) => m.id)).toEqual(b.models.map((m) => m.id));
      expect(seen[0].url).toBe(buildCatalogUrl({ apiBase: ORCAROUTER_API_BASE_DEFAULT, capability: "chat" }));
      expect(seen.map((s) => new URL(s.url).origin)).toEqual([API_ORIGIN, API_ORIGIN]);
      expect(seen.map((s) => new URL(s.url).origin)).not.toContain(AUTH_ORIGIN);
    } finally {
      await server.close();
    }
  });

  it("keeps every auth request on the auth origin and every catalog request on the API origin", async () => {
    const server = await startFakeAuthServer();
    const origins = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      origins.push({ origin: new URL(String(url)).origin, path: new URL(String(url)).pathname });
      return originalFetch(`${server.base}${new URL(String(url)).pathname}`, init);
    };
    try {
      process.env.ORCA_AUTH_BASE_URL = server.base;
      await pkceAdapter({ authBase: server.base });
      // authorize built locally, exchange went to auth origin
      expect(origins.some((o) => o.path === "/api/v1/auth/keys")).toBe(true);
      expect(origins.every((o) => o.path !== "/v1/auth/keys")).toBe(true);

      const catalogOrigins = [];
      globalThis.fetch = async (url, init) => {
        catalogOrigins.push(new URL(String(url)).origin);
        return { ok: true, status: 200, body: null, text: async () => JSON.stringify({ data: CATALOG }) };
      };
      await discoverOrcaRouterModels({ apiKey: "sk-orca-fake" });
      expect(catalogOrigins).toEqual([API_ORIGIN]);
      expect(catalogOrigins).not.toContain(AUTH_ORIGIN);
    } finally {
      globalThis.fetch = originalFetch;
      await server.close();
    }
  });
});

describe("orcarouter revoked-key handling — terminal, generation-safe", () => {
  it("treats orcarouter as a durable-credential provider", () => {
    expect(isDurableCredentialProvider("orcarouter")).toBe(true);
    expect(isDurableCredentialProvider("xai")).toBe(false);
  });

  it("flags the exact rejected credential for reauthentication on 401/403", () => {
    const conn = { accessToken: "sk-orca-current", apiKey: "sk-orca-current" };
    const fields = durableCredentialReauthFields(conn, "sk-orca-current", 401);
    expect(fields.needsReauth).toBe(true);
    expect(fields.reauthReason).toBe("credential_rejected");
    expect(durableCredentialReauthFields(conn, "sk-orca-current", 403).needsReauth).toBe(true);
  });

  it("does not flag a credential that a newer login already replaced", () => {
    // The request that failed presented the OLD key; the store now holds the
    // NEW one from a re-login. The late failure must not clobber it.
    const conn = { accessToken: "sk-orca-NEW", apiKey: "sk-orca-NEW" };
    expect(durableCredentialReauthFields(conn, "sk-orca-OLD", 401)).toBeNull();
  });

  it("ignores non-auth failures and unknown credentials", () => {
    const conn = { accessToken: "sk-orca-current" };
    expect(durableCredentialReauthFields(conn, "sk-orca-current", 429)).toBeNull();
    expect(durableCredentialReauthFields(conn, "sk-orca-current", 500)).toBeNull();
    // No proof of which credential failed → do not transition state.
    expect(durableCredentialReauthFields(conn, null, 401)).toBeNull();
    expect(durableCredentialReauthFields(null, "sk-orca-current", 401)).toBeNull();
  });

  it("flags a credential held only in apiKey (API-key adapter)", () => {
    expect(durableCredentialReauthFields({ apiKey: "sk-orca-pasted" }, "sk-orca-pasted", 401).needsReauth).toBe(true);
  });
});

// ── fixtures ─────────────────────────────────────────────────────────────────

const CATALOG = [
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    context_length: 400000,
    supported_endpoint_types: ["openai"],
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  },
];

const ISSUED_KEY = "sk-orca-fake-e2e";

async function startFakeAuthServer() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/auth")) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>Authorize</p>");
      return;
    }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      // Verify the challenge binding exactly as the real server does: the
      // verifier's hash must equal the challenge sent on the authorize URL.
      if (parsed.code_challenge_method !== "S256" || generateCodeChallenge(parsed.code_verifier) !== lastChallenge) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ key: ISSUED_KEY, user_id: "777", scope: "api" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    issuedKey: ISSUED_KEY,
    close: () => new Promise((r) => server.close(r)),
  };
}

// The challenge the current authorize attempt presented; the fixture verifies
// the exchange binds its verifier to it, exactly as the real server does.
let lastChallenge = null;
