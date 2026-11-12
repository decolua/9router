/**
 * OpenDesign Go — CLI device-authorization flow ("login with a code") used by
 * the Quota Tracker button that fetches a `vela_ctrl_...` Control Key.
 *
 * WHY this exists at all: the Control Key cannot be derived from the runtime
 * key (`sk-amr-...`). The only path the vendor offers is its own CLI login:
 *
 *   1. POST  https://amr-api.open-design.ai/api/v1/cli/device-authorizations
 *      body  {"cliVersion":"0.0.33","host":"9router","profile":"prod"}
 *      → 201 {"deviceId","userCode","deviceSecret","activationUrl","expiresAt",
 *             "pollIntervalSeconds"}
 *
 *   2. POST  .../cli/device-authorizations/{deviceId}/token
 *      body  {"deviceSecret","userCode"}           ← replayable, no auth header
 *      → 200 {"status":"pending","controlKey":null}
 *      → 200 {"status":"approved","controlKey":"vela_ctrl_...","runtimeKey":"sk-amr-...","user":{...}}
 *
 *   3. POST  .../cli/device-authorizations/{deviceId}/approve
 *      body  {"userCode"}                          ← REQUIRES the user's session cookie
 *      → 401 {"error":"unauthenticated"} without one
 *
 * WHY approve cannot be automated server-side: step 3 authenticates with the
 * *user's* amr-api session cookie, which only their browser holds after signing
 * in at `activationUrl`. A server-side bearer/secret is not enough (probed: 401),
 * so 9router can never complete this flow alone. Hence the UI has to show the
 * `userCode`, send the user to the browser, and wait.
 *
 * WHY `deviceSecret` never leaves the server: it is the *polling* credential for
 * this device authorization. Handing it to the browser would let any XSS or
 * extension replay the poll with a swapped `userCode` and take over whatever the
 * user approved. It is kept in this process's RAM only, keyed per
 * connection+device, and dropped on approval or expiry.
 *
 * WHY everything here is defensive: amr-api/cli is an *internal, undocumented*
 * API with no compatibility promise. A vendor change must degrade into an
 * error message on one card, never into a crash of the dashboard.
 */

export const OPENDESIGN_DEVICE_API_BASE = "https://amr-api.open-design.ai/api/v1";
const DEVICE_AUTH_URL = `${OPENDESIGN_DEVICE_API_BASE}/cli/device-authorizations`;

// Same shape the vendor CLI sends (cliVersion/host/profile) — probed 2026-11-12.
const CLI_VERSION = "0.0.33";
const CLI_HOST = "9router";
const CLI_PROFILE = "prod";

// Per-request ceiling; POST /cli/device-authorizations answered in ~100ms when
// probed, so 15s is a generous anti-hang bound rather than a real budget.
const DEVICE_REQUEST_TIMEOUT_MS = 15000;

// The vendor advertises ~15 minutes before `expiresAt`. The store is given a
// small grace window so an in-flight poll can still read a just-expired entry
// instead of racing the sweep; the vendor answer stays authoritative either way.
export const DEVICE_STORE_TTL_MS = 15 * 60 * 1000;
const DEVICE_STORE_TTL_GRACE_MS = 60 * 1000;

// Control Key shape: `vela_ctrl_` + opaque token, no whitespace anywhere. The
// key goes verbatim into an `Authorization: Bearer` header later, so a pasted
// value with a newline would be both a header-injection vector and a certain 401.
const CONTROL_KEY_PREFIX = "vela_ctrl_";
const CONTROL_KEY_PATTERN = /^vela_ctrl_[A-Za-z0-9._\-]+$/;

/**
 * In-memory device-authorization store, keyed `${connectionId}:${deviceId}`.
 *
 * WHY a module-level Map and not the DB: the entry lives for minutes, is
 * worthless after one approval, and must not survive a restart. Persisting it
 * would turn a transient secret into a durable one for no benefit.
 *
 * Note for multi-process deployments: this Map is per-process, so a poll landing
 * on a different replica than the one that created the device would miss it.
 * 9router is served as a single process (see custom-server.js), and the failure
 * mode is a clean "unknown device" error prompting a retry, not a wrong key.
 */
const deviceStore = new Map();

function storeKey(connectionId, deviceId) {
  return `${connectionId}:${deviceId}`;
}

/**
 * Store the server-only half of a device authorization.
 * @returns the entry, or null when the input is unusable.
 */
export function putDeviceAuthorization({ connectionId, deviceId, deviceSecret, userCode, expiresAt, intervalMs }) {
  if (!connectionId || !deviceId || !deviceSecret || !userCode) return null;

  const expiresMs = Number.isFinite(Date.parse(expiresAt))
    ? Date.parse(expiresAt)
    : Date.now() + DEVICE_STORE_TTL_MS;

  sweepExpiredDeviceAuthorizations();

  const entry = Object.freeze({
    connectionId,
    deviceId,
    deviceSecret,
    userCode,
    expiresAt,
    expiresMs,
    intervalMs,
    createdAt: Date.now(),
  });
  deviceStore.set(storeKey(connectionId, deviceId), entry);
  return entry;
}

/** Read an entry; any stored entry younger than its expiry + grace is returned. */
export function getDeviceAuthorization(connectionId, deviceId) {
  if (!connectionId || !deviceId) return null;
  const key = storeKey(connectionId, deviceId);
  const entry = deviceStore.get(key);
  if (!entry) return null;

  if (isDeviceAuthorizationExpired(entry)) {
    deviceStore.delete(key);
    return null;
  }
  return entry;
}

/** Drop one entry (called on approval and on hard failures). */
export function deleteDeviceAuthorization(connectionId, deviceId) {
  if (!connectionId || !deviceId) return false;
  return deviceStore.delete(storeKey(connectionId, deviceId));
}

export function isDeviceAuthorizationExpired(entry, now = Date.now()) {
  if (!entry || typeof entry.expiresMs !== "number") return true;
  return now > entry.expiresMs + DEVICE_STORE_TTL_GRACE_MS;
}

/**
 * Sweep stale entries. Runs on every put so a server that receives a few
 * clicks never accumulates abandoned authorizations; there is no background
 * timer on purpose (a leaking Map is a smaller problem than a timer that keeps
 * a Next.js worker alive).
 */
export function sweepExpiredDeviceAuthorizations(now = Date.now()) {
  let removed = 0;
  for (const [key, entry] of deviceStore) {
    if (isDeviceAuthorizationExpired(entry, now)) {
      deviceStore.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** Test/introspection helper — never used by request handlers. */
export function clearDeviceAuthorizations() {
  deviceStore.clear();
}

export function getDeviceAuthorizationCount() {
  return deviceStore.size;
}

/**
 * Parse the 201 answer of POST /cli/device-authorizations.
 *
 * WHY strict: without `deviceId` there is nothing to poll, without `userCode`
 * nothing to show the user, and without `deviceSecret` the poll would 401 —
 * a half-parse would surface as a confusing UI state three seconds later.
 *
 * @returns {{ok: true, device: object} | {ok: false, error: string}}
 */
export function parseDeviceAuthorizationResponse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "device authorization response was not a JSON object" };
  }

  const deviceId = nonEmptyString(body.deviceId);
  const userCode = nonEmptyString(body.userCode);
  const deviceSecret = nonEmptyString(body.deviceSecret);

  const missing = [];
  if (!deviceId) missing.push("deviceId");
  if (!userCode) missing.push("userCode");
  if (!deviceSecret) missing.push("deviceSecret");
  if (missing.length) {
    return { ok: false, error: `device authorization response missing ${missing.join("/")}` };
  }

  const expiresAt = nonEmptyString(body.expiresAt) || null;
  const intervalSeconds = Number(body.pollIntervalSeconds);
  const intervalMs = Number.isFinite(intervalSeconds) && intervalSeconds > 0
    // Vendor says 2s; clamp so a hostile/buggy value can neither hammer the
    // internal API (0.1s) nor make the UI look frozen (60s). The floor applies
    // to sub-second values too — Math.round alone would turn 0.05 into 0.
    ? Math.min(30000, Math.max(1000, Math.round(intervalSeconds * 1000)))
    : 2500;

  // The activation URL carries deviceId+userCode; without it the user has
  // nowhere to approve, so it is part of the required set in practice.
  const activationUrl = nonEmptyString(body.activationUrl) || null;
  if (!activationUrl) {
    return { ok: false, error: "device authorization response missing activationUrl" };
  }

  return {
    ok: true,
    device: { deviceId, userCode, deviceSecret, activationUrl, expiresAt, intervalMs },
  };
}

/**
 * Parse the 200 answer of POST .../{deviceId}/token.
 *
 * Only an `approved` status carrying a well-formed `vela_ctrl_` key yields the
 * key; every other shape stays keyless so a caller can never save junk into the
 * connection. `runtimeKey` is deliberately ignored — the connection's `apiKey`
 * already holds the runtime key and must not be rewritten by this flow.
 *
 * @returns {{status: "approved", controlKey: string, email: string|null}
 *         |{status: "pending"|"denied"|"expired"|"error"|"unknown", error?: string}}
 */
export function parseDeviceTokenResponse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: "error", error: "token response was not a JSON object" };
  }

  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";

  if (status === "approved") {
    // `controlKey: null` alongside "approved" happens if the vendor splits the
    // approval and the key issuance into two answers; treat it as still pending
    // rather than as a broken approval.
    if (body.controlKey === null || body.controlKey === undefined) {
      return { status: "pending" };
    }
    // Validate the RAW value, then trim: validating after a trim would launder
    // a mangled paste ("  vela_ctrl_x ") into a key that looks pristine.
    if (!isValidControlKey(body.controlKey)) {
      return { status: "error", error: "approved nhưng controlKey không hợp lệ (phải là vela_ctrl_...)" };
    }
    const controlKey = body.controlKey;
    const email = nonEmptyString(body.user?.email) || null;
    return { status: "approved", controlKey, email };
  }

  if (status === "pending") return { status: "pending" };
  if (status === "denied" || status === "rejected") return { status: "denied" };
  if (status === "expired") return { status: "expired" };
  if (!status) return { status: "error", error: "token response missing status" };

  // Unknown status from a private API: report it, do not guess a meaning.
  return { status: "unknown", error: `trạng thái không xác định: ${status}` };
}

/** A `vela_ctrl_` key with no whitespace and no control characters. */
export function isValidControlKey(value) {
  if (typeof value !== "string") return false;
  // No trimming: the key is stored verbatim and later sent in an Authorization
  // header, so anything with surrounding whitespace is a mangled paste, not a
  // key worth "repairing".
  if (!CONTROL_KEY_PATTERN.test(value)) return false;
  // Belt and braces: the pattern already excludes whitespace, but a key this
  // short cannot be a real token.
  return value.length > CONTROL_KEY_PREFIX.length + 3;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * POST /cli/device-authorizations — create a device authorization.
 * Never throws; returns an outcome so the route stays a thin wrapper.
 *
 * @returns {{ok: true, device: object} | {ok: false, error: string, status?: number}}
 */
export async function requestDeviceAuthorization({ connectionId, fetchImpl = globalThis.fetch } = {}) {
  if (!connectionId || typeof connectionId !== "string") {
    return { ok: false, error: "connectionId is required", status: 400 };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "fetch is not available" };
  }

  try {
    const response = await fetchImpl(DEVICE_AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ cliVersion: CLI_VERSION, host: CLI_HOST, profile: CLI_PROFILE }),
      signal: AbortSignal.timeout(DEVICE_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        error: `OpenDesign từ chối tạo device authorization (HTTP ${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
        status: 502,
      };
    }

    const body = await response.json().catch(() => null);
    const parsed = parseDeviceAuthorizationResponse(body);
    if (!parsed.ok) return { ok: false, error: parsed.error, status: 502 };

    // Persist the server-only half BEFORE handing anything to the client: a
    // poll can arrive before the browser finishes rendering the code.
    putDeviceAuthorization({ connectionId, ...parsed.device });
    return { ok: true, device: parsed.device };
  } catch (error) {
    return { ok: false, error: `Không gọi được OpenDesign: ${error?.message || "request failed"}`, status: 502 };
  }
}

/**
 * POST .../{deviceId}/token — one poll. Never throws.
 *
 * WHY it reads the store instead of trusting the query string: `deviceSecret`
 * and `userCode` must come from the server-held entry, so a client that only
 * knows a `deviceId` cannot poll someone else's pending approval.
 *
 * @returns {{ok: true, status: string, controlKey?: string, email?: string}
 *         |{ok: false, error: string, status?: number}}
 */
export async function pollDeviceAuthorizationToken({ connectionId, deviceId, fetchImpl = globalThis.fetch } = {}) {
  const entry = getDeviceAuthorization(connectionId, deviceId);
  if (!entry) {
    return { ok: false, error: "phiên xác nhận không tồn tại hoặc đã hết hạn — bấm lấy lại Control Key", status: 410 };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "fetch is not available" };
  }

  try {
    const response = await fetchImpl(`${DEVICE_AUTH_URL}/${encodeURIComponent(deviceId)}/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ deviceSecret: entry.deviceSecret, userCode: entry.userCode }),
      signal: AbortSignal.timeout(DEVICE_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        error: `OpenDesign poll lỗi (HTTP ${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
        status: 502,
      };
    }

    const parsed = parseDeviceTokenResponse(await response.json().catch(() => null));
    if (parsed.status === "approved") {
      // The entry is single-use: drop it so a replay of the poll cannot re-save.
      deleteDeviceAuthorization(connectionId, deviceId);
    }
    if (parsed.status === "denied" || parsed.status === "expired") {
      deleteDeviceAuthorization(connectionId, deviceId);
    }
    return { ok: true, ...parsed };
  } catch (error) {
    return { ok: false, error: `Không poll được OpenDesign: ${error?.message || "request failed"}`, status: 502 };
  }
}
