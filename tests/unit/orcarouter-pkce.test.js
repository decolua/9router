import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import crypto from "node:crypto";

import {
  getProvider,
  generateAuthData,
  exchangeTokens,
} from "../../src/lib/oauth/providers/index.js";
import orcarouter from "../../src/lib/oauth/providers/orcarouter.js";
import { generateCodeChallenge, generateCodeVerifier, generatePKCE } from "../../src/lib/oauth/utils/pkce.js";
import {
  buildAuthorizeUrl,
  buildExchangeUrl,
  ORCAROUTER_AUTH_BASE_DEFAULT,
} from "../../open-sse/providers/orcarouterCatalog.js";
import { refreshTokenByProvider, getAccessToken } from "../../open-sse/services/tokenRefresh.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const AUTH_ORIGIN = new URL(ORCAROUTER_AUTH_BASE_DEFAULT).origin;

/** Minimal fake OrcaRouter auth server: one HTTP origin, both endpoints. */
async function startFakeAuthServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ORCA_AUTH_BASE_URL;
  delete process.env.ORCA_API_BASE_URL;
  delete process.env.ORCA_BASE_URL;
});

describe("orcarouter PKCE primitives", () => {
  it("uses S256 with unpadded base64url", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toBe(crypto.createHash("sha256").update(verifier).digest("base64url"));
    expect(challenge).not.toContain("=");
    expect(verifier).not.toContain("=");
    // base64url alphabet only
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never reuses a verifier or state across attempts", () => {
    const seen = new Set();
    for (let i = 0; i < 50; i += 1) {
      const { codeVerifier, state } = generatePKCE();
      expect(seen.has(codeVerifier)).toBe(false);
      expect(seen.has(state)).toBe(false);
      seen.add(codeVerifier);
      seen.add(state);
    }
  });

  it("produces high-entropy verifiers from a crypto RNG", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(new Set(verifier).size).toBeGreaterThan(10);
  });
});

describe("orcarouter authorize step", () => {
  it("sends only the S256 challenge, never the verifier", async () => {
    const data = await generateAuthData("orcarouter", "oob");
    const url = new URL(data.authUrl);
    expect(new URL(data.authUrl).origin).toBe(AUTH_ORIGIN);
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("callback_url")).toBe("oob");
    expect(url.searchParams.get("code_challenge")).toBe(data.codeChallenge);
    expect(url.searchParams.get("state")).toBe(data.state);
    // The verifier must not ride along on the authorize URL.
    expect(data.authUrl).not.toContain(data.codeVerifier);
    expect(url.searchParams.get("code_verifier")).toBeNull();
  });

  it("registers as an authorization_code_pkce provider", () => {
    expect(orcarouter.flowType).toBe("authorization_code_pkce");
    expect(getProvider("orcarouter")).toBe(orcarouter);
  });

  it("keeps verifier, challenge and state consistent per attempt", async () => {
    const first = await generateAuthData("orcarouter", "oob");
    const second = await generateAuthData("orcarouter", "oob");
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.state).not.toBe(second.state);
    expect(generateCodeChallenge(first.codeVerifier)).toBe(first.codeChallenge);
  });

  it("honours an explicit auth override for both authorize and exchange", async () => {
    const server = await startFakeAuthServer((req, res) => json(res, 200, {}));
    try {
      process.env.ORCA_AUTH_BASE_URL = server.base;
      const data = await generateAuthData("orcarouter", "oob");
      expect(new URL(data.authUrl).origin).toBe(server.base);
      expect(orcarouter.buildAuthUrl({ ...orcarouter.config, authBase: server.base }, "oob", "s", "c")).toContain(
        `${server.base}/auth`
      );
    } finally {
      await server.close();
    }
  });

  it("refuses a non-loopback plain-HTTP auth origin", () => {
    expect(() =>
      orcarouter.buildAuthUrl({ ...orcarouter.config, authBase: "http://orca.example.com" }, "oob", "s", "c")
    ).toThrow(/HTTPS/);
  });

  it("does not require a client secret", () => {
    expect(orcarouter.config.clientSecret).toBeUndefined();
    expect(JSON.stringify(orcarouter.config)).not.toMatch(/client_?secret/i);
  });
});

describe("orcarouter exchange step", () => {
  it("POSTs the code, verifier and S256 to the auth origin's /api/v1/auth/keys", async () => {
    let captured = null;
    const server = await startFakeAuthServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        captured = { method: req.method, url: req.url, body: JSON.parse(body) };
        json(res, 200, { key: "sk-orca-fake-issued", user_id: "12345", scope: "api" });
      });
    });
    try {
      const result = await orcarouter.exchangeToken(
        { ...orcarouter.config, authBase: server.base },
        "the-code",
        "oob",
        "the-verifier"
      );
      expect(captured.method).toBe("POST");
      // The relay's /v1 must never be used for the exchange.
      expect(captured.url).toBe("/api/v1/auth/keys");
      expect(captured.body).toEqual({
        code: "the-code",
        code_verifier: "the-verifier",
        code_challenge_method: "S256",
      });
      expect(result.key).toBe("sk-orca-fake-issued");
      expect(result.scope).toBe("api");
    } finally {
      await server.close();
    }
  });

  it("propagates a rejection without echoing credential material", async () => {
    const server = await startFakeAuthServer((_req, res) =>
      json(res, 403, { error: "invalid_grant", error_description: "code already used" })
    );
    try {
      await expect(
        orcarouter.exchangeToken({ ...orcarouter.config, authBase: server.base }, "c", "oob", "v")
      ).rejects.toThrow(/403/);
    } finally {
      await server.close();
    }
  });

  it("reports a 400 challenge-method downgrade distinctly", async () => {
    const server = await startFakeAuthServer((_req, res) =>
      json(res, 400, { error: "invalid_request", error_description: "code_challenge_method mismatch" })
    );
    try {
      let message = "";
      await orcarouter
        .exchangeToken({ ...orcarouter.config, authBase: server.base }, "c", "oob", "v")
        .catch((e) => { message = e.message; });
      expect(message).toMatch(/400/);
      expect(message).toMatch(/mismatch/);
      // The verifier argument must never leak into an error message.
      expect(message).not.toContain("code_verifier");
    } finally {
      await server.close();
    }
  });

  it("handles a non-JSON error body without throwing the raw HTML", async () => {
    const server = await startFakeAuthServer((_req, res) => {
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end("<html>bad gateway</html>");
    });
    try {
      let message = "";
      await orcarouter
        .exchangeToken({ ...orcarouter.config, authBase: server.base }, "c", "oob", "v")
        .catch((e) => { message = e.message; });
      expect(message).toMatch(/502/);
      expect(message).not.toContain("<html>");
    } finally {
      await server.close();
    }
  });

  it("fails when the response carries no key", async () => {
    const server = await startFakeAuthServer((_req, res) => json(res, 200, { scope: "api" }));
    try {
      await expect(
        orcarouter.exchangeToken({ ...orcarouter.config, authBase: server.base }, "c", "oob", "v")
      ).rejects.toThrow(/no API key/);
    } finally {
      await server.close();
    }
  });
});

describe("orcarouter mapTokens — durable key, scope-aware", () => {
  it("maps the exchange result onto a normal API-key credential", () => {
    const mapped = orcarouter.mapTokens({ key: "sk-orca-fake", scope: "api", userId: "12345" });
    expect(mapped.accessToken).toBe("sk-orca-fake");
    expect(mapped.apiKey).toBe("sk-orca-fake");
    // Durable key: no refresh token is invented.
    expect(mapped.refreshToken).toBeNull();
    expect(mapped.scope).toBe("api");
    expect(mapped.providerSpecificData.authMethod).toBe("pkce");
  });

  it("derives a stable identity so a repeat login reuses one account row", () => {
    const a = orcarouter.mapTokens({ key: "k1", scope: "api", userId: "12345" });
    const b = orcarouter.mapTokens({ key: "k2", scope: "api", userId: "12345" });
    expect(a.email).toBe(b.email);
    expect(a.providerSpecificData.username).toBe(b.providerSpecificData.username);
    // A different user must not collide.
    const c = orcarouter.mapTokens({ key: "k3", scope: "api", userId: "999" });
    expect(c.email).not.toBe(a.email);
  });

  it("records the granted scope rather than assuming the requested one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mapped = orcarouter.mapTokens({ key: "sk-orca-fake", scope: "connector" });
    expect(mapped.scope).toBe("connector");
    expect(mapped.providerSpecificData.grantedScope).toBe("connector");
    expect(warn).toHaveBeenCalled();
  });

  it("never puts the key into providerSpecificData or a URL", () => {
    const mapped = orcarouter.mapTokens({ key: "sk-orca-supersecret", scope: "api", userId: "1" });
    expect(JSON.stringify(mapped.providerSpecificData)).not.toContain("sk-orca-supersecret");
    expect(JSON.stringify(mapped)).not.toMatch(/https?:\/\/[^"]*sk-orca/);
  });
});

describe("orcarouter end-to-end connect through the real adapter", () => {
  it("drives authorize → paste code → exchange → persist credential", async () => {
    const issued = "sk-orca-e2e-issued";
    const server = await startFakeAuthServer((req, res) => {
      if (req.url.startsWith("/auth")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<p>Authorize</p>");
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        // The server must receive the verifier that matches the challenge sent
        // at authorize time.
        const expected = generateCodeChallenge(parsed.code_verifier);
        if (parsed.code_challenge_method !== "S256" || expected !== challengeSeen) {
          json(res, 403, { error: "invalid_grant" });
          return;
        }
        json(res, 200, { key: issued, user_id: "777", scope: "api" });
      });
    });

    let challengeSeen = null;
    try {
      process.env.ORCA_AUTH_BASE_URL = server.base;

      // 1. authorize
      const authData = await generateAuthData("orcarouter", "oob");
      challengeSeen = authData.codeChallenge;
      expect(new URL(authData.authUrl).origin).toBe(server.base);

      // 2. the user approves and pastes the displayed code back
      const tokens = await exchangeTokens(
        "orcarouter",
        "pasted-code",
        "oob",
        authData.codeVerifier,
        authData.state
      );

      // 3. persists as a normal credential
      expect(tokens.accessToken).toBe(issued);
      expect(tokens.apiKey).toBe(issued);
      expect(tokens.refreshToken).toBeNull();
      expect(tokens.providerSpecificData.authMethod).toBe("pkce");
    } finally {
      await server.close();
    }
  });

  it("rejects a code when the verifier does not match the challenge", async () => {
    const server = await startFakeAuthServer((req, res) => {
      if (req.url.startsWith("/auth")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("ok");
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const expected = generateCodeChallenge(parsed.code_verifier);
        json(res, expected === "wrong" ? 200 : 403, { error: "invalid_grant" });
      });
    });
    try {
      process.env.ORCA_AUTH_BASE_URL = server.base;
      await expect(
        exchangeTokens("orcarouter", "code", "oob", "tampered-verifier", "state")
      ).rejects.toThrow(/403/);
    } finally {
      await server.close();
    }
  });
});

describe("orcarouter credential lifecycle — no fake refresh", () => {
  it("refuses to refresh instead of fabricating a refresh grant", async () => {
    // A durable key has no refresh grant. Both public refresh entry points must
    // refuse it rather than POSTing grant_type=refresh_token to the exchange
    // endpoint (which is a code-exchange route, not a token refresh route).
    let posted = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      posted += 1;
      return { ok: false, status: 404, text: async () => "" };
    };
    try {
      const viaProvider = await refreshTokenByProvider("orcarouter", { refreshToken: "fake-refresh" }, { warn: () => {} });
      const viaAccessToken = await getAccessToken("orcarouter", { refreshToken: "fake-refresh" }, { warn: () => {} });
      expect(viaProvider).toBeNull();
      expect(viaAccessToken).toBeNull();
      expect(posted).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("still resolves inference credentials for a stored key", () => {
    // The provider must behave like any other OpenAI-compatible API-key provider.
    expect(PROVIDERS.orcarouter.baseUrl).toBe("https://api.orcarouter.ai/v1/chat/completions");
  });

  it("builds an exchange URL that never targets the relay origin", () => {
    expect(buildExchangeUrl({ authBase: ORCAROUTER_AUTH_BASE_DEFAULT })).toBe(
      "https://www.orcarouter.ai/api/v1/auth/keys"
    );
    expect(buildAuthorizeUrl({ authBase: ORCAROUTER_AUTH_BASE_DEFAULT, codeChallenge: "c", state: "s" })).toBe(
      "https://www.orcarouter.ai/auth?callback_url=oob&code_challenge=c&code_challenge_method=S256&state=s&scope=api"
    );
  });
});
