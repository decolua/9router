/**
 * Codex (OpenAI) bulk-import normalization
 *
 * Accepts the JSON shape produced by Codex CLI / common token-export tools and
 * returns a {@link createProviderConnection} payload (or a typed error).
 *
 * Pure: no I/O, no network. Safe to unit-test.
 */

const REQUIRED_FIELDS = ["access_token", "refresh_token"];

// 10 days, the typical OpenAI access-token lifetime when no `expired` is supplied.
const DEFAULT_EXPIRY_MS = 10 * 24 * 60 * 60 * 1000;

const BASE64_BLOCK_SIZE = 4;

/**
 * Decode a JWT payload to a plain object (no signature verification).
 *
 * Mirrors the helper in `providers.js` but is kept local so this module has no
 * runtime dependency on the larger OAuth module graph.
 *
 * @param {unknown} jwt
 * @returns {Record<string, unknown> | null}
 */
function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding =
      (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) %
      BASE64_BLOCK_SIZE;
    const padded = base64 + "=".repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractCodexAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return {};
  const chatgpt =
    /** @type {Record<string, unknown>} */ (
      payload["https://api.openai.com/auth"]
    ) || {};
  return {
    email: typeof payload.email === "string" ? payload.email : undefined,
    chatgptAccountId:
      typeof chatgpt.chatgpt_account_id === "string"
        ? chatgpt.chatgpt_account_id
        : undefined,
    chatgptPlanType:
      typeof chatgpt.chatgpt_plan_type === "string"
        ? chatgpt.chatgpt_plan_type
        : undefined,
  };
}

/**
 * @param {unknown} input — single record from the uploaded JSON
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function normalizeCodexImportRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Record is not an object" };
  }
  const rec = /** @type {Record<string, unknown>} */ (unwrapCodexAuthJson(input));

  // Allow type field to be missing or "codex"; reject anything else explicitly so
  // users don't accidentally import claude/gemini exports through this path.
  if (rec.type !== undefined && rec.type !== null && rec.type !== "codex") {
    return { ok: false, error: `Unsupported type: ${String(rec.type)}` };
  }

  for (const f of REQUIRED_FIELDS) {
    if (typeof rec[f] !== "string" || !rec[f]) {
      return { ok: false, error: `Missing required field: ${f}` };
    }
  }

  const accessToken = String(rec.access_token);
  const refreshToken = String(rec.refresh_token);
  const idToken = typeof rec.id_token === "string" ? rec.id_token : undefined;

  // Prefer JWT-derived account info, fall back to top-level fields.
  const fromJwt = idToken ? extractCodexAccountInfo(idToken) : {};
  const email = pickString(fromJwt.email, rec.email);

  if (!email) {
    return { ok: false, error: "Missing email (and id_token does not contain one)" };
  }

  const chatgptAccountId = pickString(fromJwt.chatgptAccountId, rec.account_id);
  const chatgptPlanType = pickString(fromJwt.chatgptPlanType);

  const expiresAt = parseExpiry(rec.expired) || parseAccessTokenExp(accessToken);

  const providerSpecificData = {};
  if (chatgptAccountId) providerSpecificData.chatgptAccountId = chatgptAccountId;
  if (chatgptPlanType) providerSpecificData.chatgptPlanType = chatgptPlanType;

  /** @type {Record<string, unknown>} */
  const payload = {
    provider: "codex",
    authType: "oauth",
    accessToken,
    refreshToken,
    email,
    expiresAt,
    testStatus: "active",
  };
  if (idToken) payload.idToken = idToken;
  if (Object.keys(providerSpecificData).length > 0) {
    payload.providerSpecificData = providerSpecificData;
  }

  return { ok: true, payload };
}

/**
 * Flatten the user-uploaded JSON into an array of candidate records.
 * Accepts a single record or an array; rejects anything else.
 *
 * @param {unknown} parsed
 * @returns {{ ok: true, records: unknown[] } | { ok: false, error: string }}
 */
export function flattenCodexImportPayload(parsed) {
  if (Array.isArray(parsed)) {
    return { ok: true, records: parsed };
  }
  if (parsed && typeof parsed === "object") {
    return { ok: true, records: [parsed] };
  }
  return { ok: false, error: "JSON must be an object or an array of objects" };
}

function pickString(...candidates) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

function parseExpiry(value) {
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return undefined;
}

function parseAccessTokenExp(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const exp = payload && typeof payload.exp === "number" ? payload.exp : null;
  if (exp && Number.isFinite(exp)) {
    return new Date(exp * 1000).toISOString();
  }
  return new Date(Date.now() + DEFAULT_EXPIRY_MS).toISOString();
}

/**
 * Codex CLI persists tokens to `auth.json` with the OAuth fields nested under
 * a `tokens` object: `{ auth_mode, OPENAI_API_KEY, tokens: { id_token, ... } }`.
 * Flatten that into the same shape as the simple top-level export so the rest
 * of the normalizer can stay unchanged.
 *
 * @param {object} rec
 * @returns {object}
 */
function unwrapCodexAuthJson(rec) {
  const tokens = /** @type {Record<string, unknown> | undefined} */ (rec.tokens);
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return rec;
  }
  if (typeof tokens.access_token !== "string") return rec;
  // Tokens take priority; carry through siblings (email / account_id / expired)
  // only when the nested object doesn't already define them.
  return { ...rec, ...tokens };
}
