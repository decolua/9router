import { randomUUID } from "node:crypto";

export const MODEL_WHITELIST_BYPASS_HEADER = "x-9r-bypass-model-whitelist";
export const MODEL_WHITELIST_BYPASS_VALUE = "diagnostic-model-test";
export const MODEL_WHITELIST_BYPASS_NONCE_HEADER = "x-9r-bypass-model-whitelist-nonce";
export const CLI_TOKEN_HEADER = "x-9r-cli-token";
export const CLI_TOKEN_SALT = "9r-cli-auth";

const NONCE_TTL_MS = 30_000;
const MAX_NONCES = 1000;
const STORE_KEY = Symbol.for("9router.modelDiagnosticBypassNonces");

function getStore() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = new Map();
  return globalThis[STORE_KEY];
}

function pruneExpiredNonces(store, now) {
  for (const [nonce, expiresAt] of store) {
    if (expiresAt <= now) store.delete(nonce);
  }
  while (store.size > MAX_NONCES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function createModelWhitelistBypassNonce() {
  const store = getStore();
  const now = Date.now();
  pruneExpiredNonces(store, now);
  const nonce = randomUUID();
  store.set(nonce, now + NONCE_TTL_MS);
  return nonce;
}

export function consumeModelWhitelistBypassNonce(nonce) {
  if (!nonce) return false;
  const store = getStore();
  const now = Date.now();
  pruneExpiredNonces(store, now);
  const expiresAt = store.get(nonce);
  if (!expiresAt) return false;
  store.delete(nonce);
  return expiresAt > now;
}

let cliTokenPromise = null;

function getCliToken() {
  if (!cliTokenPromise) {
    cliTokenPromise = (async () => {
      const { getConsistentMachineId } = await import("@/shared/utils/machineId");
      return getConsistentMachineId(CLI_TOKEN_SALT);
    })();
  }
  return cliTokenPromise;
}

/**
 * Validate that a request is an authorized internal diagnostic model-test call
 * permitted to bypass the per-account model whitelist. Requires: the bypass
 * header value, a localhost target host, the machine-derived CLI token, and a
 * single-use nonce. The nonce is consumed on success.
 *
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function hasDiagnosticModelTestBypass(request) {
  if (request?.headers?.get(MODEL_WHITELIST_BYPASS_HEADER) !== MODEL_WHITELIST_BYPASS_VALUE) return false;
  const hostname = new URL(request.url).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") return false;
  const cliToken = await getCliToken();
  if (request.headers.get(CLI_TOKEN_HEADER) !== cliToken) return false;
  return consumeModelWhitelistBypassNonce(request.headers.get(MODEL_WHITELIST_BYPASS_NONCE_HEADER));
}
