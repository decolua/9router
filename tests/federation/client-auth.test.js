// FED-011 — central-side client-auth relay unit tests.
//
// Covers: edge-proxied request (Authorization = federation token +
// X-9r-Client-Authorization = client key) resolves to the CLIENT key; plain
// client keys pass through untouched; standalone/central without federation
// sees zero behavior change; raw (non-Bearer) relay values; missing/invalid
// pieces never leak the federation token as a client key.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = ["FEDERATION_MODE", "FEDERATION_TOKEN", "FEDERATION_CENTRAL_URL"];

const savedEnv = {};

beforeEach(() => {
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function loadHelper() {
  return import("@/lib/federation/clientAuth.js");
}

// Next-style Request headers (Headers.get) — what both central auth layers use.
function reqWith(headers) {
  return { headers: new Headers(headers) };
}

describe("getRelayedClientApiKey — edge-proxied requests (FED-011)", () => {
  it("resolves the client key when Authorization is the federation token", async () => {
    process.env.FEDERATION_TOKEN = "fed-token-secret";
    const { getRelayedClientApiKey } = await loadHelper();
    const key = getRelayedClientApiKey(
      reqWith({
        authorization: "Bearer fed-token-secret",
        "x-9r-client-authorization": "Bearer sk-client-key",
      })
    );
    expect(key).toBe("sk-client-key");
  });

  it("returns null when Authorization is a normal client key (not the federation token)", async () => {
    process.env.FEDERATION_TOKEN = "fed-token-secret";
    const { getRelayedClientApiKey } = await loadHelper();
    const key = getRelayedClientApiKey(
      reqWith({
        authorization: "Bearer sk-client-key",
        "x-9r-client-authorization": "Bearer sk-other",
      })
    );
    expect(key).toBeNull();
  });

  it("never treats the federation token itself as a client key when relay header absent", async () => {
    process.env.FEDERATION_TOKEN = "fed-token-secret";
    const { getRelayedClientApiKey } = await loadHelper();
    const key = getRelayedClientApiKey(
      reqWith({ authorization: "Bearer fed-token-secret" })
    );
    expect(key).toBeNull();
  });

  it("returns null on token mismatch (constant-time compare, wrong token)", async () => {
    process.env.FEDERATION_TOKEN = "fed-token-secret";
    const { getRelayedClientApiKey } = await loadHelper();
    const key = getRelayedClientApiKey(
      reqWith({
        authorization: "Bearer wrong-token",
        "x-9r-client-authorization": "Bearer sk-client-key",
      })
    );
    expect(key).toBeNull();
  });

  it("handles raw (non-Bearer) relay values", async () => {
    process.env.FEDERATION_TOKEN = "fed-token-secret";
    const { getRelayedClientApiKey } = await loadHelper();
    const key = getRelayedClientApiKey(
      reqWith({
        authorization: "Bearer fed-token-secret",
        "x-9r-client-authorization": "sk-raw-client-key",
      })
    );
    expect(key).toBe("sk-raw-client-key");
  });

  it("works with node:http-style lowercase plain-object headers", async () => {
    process.env.FEDERATION_TOKEN = "fed-token-secret";
    const { getRelayedClientApiKey } = await loadHelper();
    const key = getRelayedClientApiKey({
      headers: {
        authorization: "Bearer fed-token-secret",
        "x-9r-client-authorization": "Bearer sk-client-key",
      },
    });
    expect(key).toBe("sk-client-key");
  });

  it("zero behavior change when FEDERATION_TOKEN is not configured (standalone)", async () => {
    const { getRelayedClientApiKey } = await loadHelper();
    // Even a matching-shaped pair must not activate without a configured token.
    const key = getRelayedClientApiKey(
      reqWith({
        authorization: "Bearer some-token",
        "x-9r-client-authorization": "Bearer sk-client-key",
      })
    );
    expect(key).toBeNull();
  });

  it("returns null for missing headers or missing Authorization", async () => {
    process.env.FEDERATION_TOKEN = "fed-token-secret";
    const { getRelayedClientApiKey } = await loadHelper();
    expect(getRelayedClientApiKey(reqWith({}))).toBeNull();
    expect(getRelayedClientApiKey({})).toBeNull();
    expect(getRelayedClientApiKey(null)).toBeNull();
  });
});
