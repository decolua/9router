// Zed HOSTED-mode callback contract (VPS + remote dashboard origin).
// The dashboard runs on a remote origin, so the loopback proxy is never
// started; the user signs in at zed.dev and pastes the 127.0.0.1 callback URL
// back into the modal, which POSTs it to /exchange for server-side decrypt.
// These tests pin the primitives that flow depends on — no npm deps beyond
// vitest + node builtins (runs without root node_modules).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  createZedNativeAuthData,
  parseZedCallbackPayload,
  decryptZedAccessToken,
} from "open-sse/shared/zedAuth.js";

// Simulate Zed's side: RSA-encrypt a token against the attempt's public key
// (OAEP-SHA256, matching decryptZedAccessToken's primary path).
function zedEncrypt(publicKeyB64url, plaintext) {
  const der = Buffer.from(
    publicKeyB64url.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  const key = crypto.createPublicKey({ key: der, format: "der", type: "pkcs1" });
  return crypto
    .publicEncrypt(
      {
        key,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(plaintext),
    )
    .toString("base64url");
}

describe("zed hosted authorize shape (what GET /authorize returns)", () => {
  it("sign-in URL targets zed.dev with port + public key, and NO redirect_uri", () => {
    // createZedNativeAuthData with no port option falls back to the default
    // native-app port. The modal's hosted call hits GET /authorize with no
    // redirect_uri (the route default only feeds the attempt material); the
    // callback port itself is irrelevant to parsing (pinned below), so any
    // derived port works for the paste-callback flow.
    const auth = createZedNativeAuthData({}, {});
    const url = new URL(auth.authUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://zed.dev/native_app_signin",
    );
    expect(url.searchParams.get("native_app_port")).toBe("58443");
    expect(url.searchParams.get("native_app_public_key")).toBeTruthy();
    expect(url.searchParams.get("system_id")).toBe(auth.systemId);
    expect(url.searchParams.has("redirect_uri")).toBe(false);
    expect(auth.privateKeyVerifier.startsWith("zed-rsa-pkcs1:")).toBe(true);
  });
});

describe("zed hosted paste-callback round trip", () => {
  it("pasted 127.0.0.1 URL parses and decrypts with the attempt's own key", () => {
    const auth = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    const enc = zedEncrypt(auth.publicKey, "hosted-token-xyz");
    const pasted = `http://127.0.0.1:58443/?user_id=user-123&access_token=${enc}`;
    const { userId, encryptedAccessToken } = parseZedCallbackPayload(pasted);
    expect(userId).toBe("user-123");
    expect(decryptZedAccessToken(encryptedAccessToken, auth.privateKeyVerifier)).toBe(
      "hosted-token-xyz",
    );
  });

  it("callback port is irrelevant — any loopback port parses", () => {
    const auth = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    const enc = zedEncrypt(auth.publicKey, "tok");
    const { userId } = parseZedCallbackPayload(
      `http://127.0.0.1:9999/?user_id=u&access_token=${enc}`,
    );
    expect(userId).toBe("u");
  });

  it("a callback pasted into a DIFFERENT attempt never yields that attempt's token (session isolation)", () => {
    const attemptA = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    const attemptB = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    const enc = zedEncrypt(attemptA.publicKey, "tok");
    const { encryptedAccessToken } = parseZedCallbackPayload(
      `http://127.0.0.1:58443/?user_id=u&access_token=${enc}`,
    );
    // Wrong-key decrypt either throws or returns garbage — but it must never
    // return attempt A's real token under attempt B's key.
    let result = null;
    let threw = false;
    try {
      result = decryptZedAccessToken(
        encryptedAccessToken,
        attemptB.privateKeyVerifier,
      );
    } catch {
      threw = true;
    }
    expect(threw || result !== "tok").toBe(true);
  });

  it("rejects callbacks missing user_id or access_token", () => {
    expect(() =>
      parseZedCallbackPayload("http://127.0.0.1:58443/?user_id=u"),
    ).toThrow(/user_id and access_token/);
    expect(() => parseZedCallbackPayload("")).toThrow(/Missing Zed callback/);
  });
});

describe("zed hosted server-side exchange (what POST /exchange runs)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // postExchange's user/org lookup is best-effort — fail it fast and loud
    // instead of touching the real network. Decrypt + token shaping are local.
    globalThis.fetch = async (url) => {
      if (String(url).includes("cloud.zed.dev")) {
        return new Response("test-stubbed", { status: 500 });
      }
      return realFetch(url);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("pasted callback decrypts and yields storable tokens (no proxy involved)", async () => {
    const { exchangeTokens } = await import(
      "@/lib/oauth/providers/index.js"
    );
    const auth = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    const enc = zedEncrypt(auth.publicKey, "hosted-token-xyz");
    const pasted = `http://127.0.0.1:58443/?user_id=user-123&access_token=${enc}`;

    // Same argument shape the modal's hosted/manual submit sends:
    // code = pasted URL, redirectUri + codeVerifier = attempt material.
    const tokens = await exchangeTokens(
      "zed",
      pasted,
      "http://localhost:8080/callback",
      auth.privateKeyVerifier,
      undefined,
    );

    expect(tokens.accessToken).toBe("hosted-token-xyz");
    expect(tokens.providerSpecificData?.userId).toBe("user-123");
    expect(tokens.providerSpecificData?.authMethod).toBe("oauth");
    // systemId is always stored. When the login attempt's own id is threaded
    // through meta (as the modal does via authData.systemId), exchange prefers
    // it over the freshly prepared config value.
    expect(tokens.providerSpecificData?.systemId).toBeTruthy();
    // Attempt secrets must not ride along in the storable token payload.
    expect(tokens).not.toHaveProperty("codeVerifier");
    expect(tokens).not.toHaveProperty("privateKeyVerifier");
  });

  it("garbage pasted input fails closed with a safe error", async () => {
    const { exchangeTokens } = await import(
      "@/lib/oauth/providers/index.js"
    );
    const auth = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    await expect(
      exchangeTokens(
        "zed",
        "http://127.0.0.1:58443/?user_id=u",
        "http://localhost:8080/callback",
        auth.privateKeyVerifier,
        undefined,
      ),
    ).rejects.toThrow(/user_id and access_token/);
  });
});

describe("zed hosted error hygiene (no secrets in errors)", () => {
  it("parse/decrypt failures never echo key material or tokens", () => {
    const auth = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    const probe = "not-a-callback";
    let parseErr = null;
    try {
      parseZedCallbackPayload(probe);
    } catch (err) {
      parseErr = err;
    }
    expect(parseErr).not.toBeNull();
    expect(String(parseErr.message)).not.toContain(probe);

    const other = createZedNativeAuthData({}, { nativeAppPort: 58443 });
    const enc = zedEncrypt(other.publicKey, "secret-token");
    let decryptResult = null;
    let decryptThrew = false;
    try {
      decryptResult = decryptZedAccessToken(enc, auth.privateKeyVerifier);
    } catch (err) {
      decryptThrew = true;
      decryptResult = String(err.message);
    }
    // Either a throw or garbage — but never the real token, never key material.
    expect(decryptThrew || decryptResult !== "secret-token").toBe(true);
    expect(String(decryptResult)).not.toContain(auth.privateKeyVerifier);
  });
});
