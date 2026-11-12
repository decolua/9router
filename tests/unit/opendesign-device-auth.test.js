// OpenDesign Go device-authorization flow (the "Lấy Control Key" button).
// Payloads are the live-probed shapes from 2026-11-12; checkpoints:
//   - POST /cli/device-authorizations (no auth) → 201 with deviceSecret
//   - POST /{deviceId}/token replayed while pending → 200 {"status":"pending","controlKey":null}
//   - POST /{deviceId}/token after browser approval → 200 {"status":"approved","controlKey":"vela_ctrl_..."}
//   - POST /{deviceId}/approve without the user cookie → 401 {"error":"unauthenticated"}
// The last one is why the flow cannot be automated server-side and the UI must
// show a code + an activation link. These tests pin the parsing and the
// server-only secret store; the network legs run against a stub fetch.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDeviceAuthorizations,
  deleteDeviceAuthorization,
  getDeviceAuthorization,
  getDeviceAuthorizationCount,
  isDeviceAuthorizationExpired,
  isValidControlKey,
  parseDeviceAuthorizationResponse,
  parseDeviceTokenResponse,
  pollDeviceAuthorizationToken,
  putDeviceAuthorization,
  requestDeviceAuthorization,
  sweepExpiredDeviceAuthorizations,
  OPENDESIGN_DEVICE_API_BASE,
  DEVICE_STORE_TTL_MS,
} from "../../src/lib/opendesignDeviceAuth.js";

const DEVICE_AUTH_URL = `${OPENDESIGN_DEVICE_API_BASE}/cli/device-authorizations`;
const CONNECTION_ID = "conn_opendesign_1";
const DEVICE_ID = "dev_abc123";
const DEVICE_SECRET = "dsec_very_private";
const USER_CODE = "78KP4T";
const CONTROL_KEY = "vela_ctrl_fixtureplaceholder";
const EXPIRES_AT = nowPlus(15 * 60 * 1000);

// Verbatim 201 answer of POST /cli/device-authorizations (trimmed to the
// fields nine-router reads).
const SAMPLE_DEVICE = {
  deviceId: DEVICE_ID,
  userCode: USER_CODE,
  status: "pending",
  deviceSecret: DEVICE_SECRET,
  activationUrl: `https://open-design.ai/cloud/cli/activate?deviceId=${DEVICE_ID}&userCode=${USER_CODE}`,
  expiresAt: EXPIRES_AT,
  pollIntervalSeconds: 2,
};

// Verbatim pending answer of POST /{deviceId}/token.
const SAMPLE_TOKEN_PENDING = {
  status: "pending",
  deviceId: DEVICE_ID,
  userCode: USER_CODE,
  controlKey: null,
  runtimeKey: null,
  user: null,
  expiresAt: EXPIRES_AT,
};

// Verbatim approved answer of POST /{deviceId}/token (key values synthetic).
const SAMPLE_TOKEN_APPROVED = {
  status: "approved",
  deviceId: DEVICE_ID,
  userCode: USER_CODE,
  controlKey: CONTROL_KEY,
  runtimeKey: "sk-amr-probe-runtime",
  user: { email: "probe@example.invalid" },
  expiresAt: EXPIRES_AT,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Relative expiries keep the store assertions independent of the wall clock
// (a hard-coded date would silently expire the moment these payloads age out).
function nowPlus(ms) {
  return new Date(Date.now() + ms).toISOString();
}

beforeEach(() => {
  clearDeviceAuthorizations();
});

describe("device authorization store (server-only secret)", () => {
  it("puts and gets an entry keyed by connection + device", () => {
    const entry = putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: EXPIRES_AT,
      intervalMs: 2000,
    });

    expect(entry).not.toBeNull();
    expect(entry.deviceSecret).toBe(DEVICE_SECRET);
    expect(getDeviceAuthorization(CONNECTION_ID, DEVICE_ID)).toMatchObject({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: EXPIRES_AT,
      intervalMs: 2000,
    });
    expect(getDeviceAuthorizationCount()).toBe(1);
  });

  it("returns null for a different connection or device", () => {
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: EXPIRES_AT,
    });

    expect(getDeviceAuthorization("other_conn", DEVICE_ID)).toBeNull();
    expect(getDeviceAuthorization(CONNECTION_ID, "other_device")).toBeNull();
    expect(getDeviceAuthorization(null, DEVICE_ID)).toBeNull();
    expect(getDeviceAuthorization(CONNECTION_ID, null)).toBeNull();
  });

  it("refuses to store an incomplete authorization", () => {
    expect(putDeviceAuthorization({ connectionId: CONNECTION_ID, deviceId: DEVICE_ID, userCode: USER_CODE })).toBeNull();
    expect(putDeviceAuthorization({ connectionId: CONNECTION_ID, deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET })).toBeNull();
    expect(putDeviceAuthorization({ deviceId: DEVICE_ID, deviceSecret: DEVICE_SECRET, userCode: USER_CODE })).toBeNull();
    expect(getDeviceAuthorizationCount()).toBe(0);
  });

  it("deletes one entry", () => {
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: EXPIRES_AT,
    });

    expect(deleteDeviceAuthorization(CONNECTION_ID, DEVICE_ID)).toBe(true);
    expect(getDeviceAuthorization(CONNECTION_ID, DEVICE_ID)).toBeNull();
    expect(deleteDeviceAuthorization(CONNECTION_ID, DEVICE_ID)).toBe(false);
  });

  it("expires an entry past its TTL and drops it on read", () => {
    const expiresAt = nowPlus(60 * 1000);
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt,
    });

    const entry = getDeviceAuthorization(CONNECTION_ID, DEVICE_ID);
    // The entry is still there for the expiry check itself...
    expect(entry).not.toBeNull();
    expect(isDeviceAuthorizationExpired(entry, entry.expiresMs + 1000)).toBe(false);
    expect(isDeviceAuthorizationExpired(entry, entry.expiresMs + DEVICE_STORE_TTL_MS + 1000)).toBe(true);

    // ...but reading it past expiry + grace drops it (the store injects its own
    // clock, so this is asserted through the sweep at the same instant).
    expect(sweepExpiredDeviceAuthorizations(entry.expiresMs + DEVICE_STORE_TTL_MS + 1000)).toBe(1);
    expect(getDeviceAuthorization(CONNECTION_ID, DEVICE_ID)).toBeNull();
    expect(getDeviceAuthorizationCount()).toBe(0);
  });

  it("sweeps every expired entry in one pass", () => {
    const expiresAt = nowPlus(1000);
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt,
    });
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: "dev_second",
      deviceSecret: "dsec_second",
      userCode: "ABCDEF",
      expiresAt,
    });

    expect(sweepExpiredDeviceAuthorizations(Date.parse(expiresAt) + DEVICE_STORE_TTL_MS + 1000)).toBe(2);
    expect(getDeviceAuthorizationCount()).toBe(0);
  });

  it("falls back to the 15-minute TTL when the vendor sends no expiry", () => {
    const before = Date.now();
    const entry = putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: undefined,
    });

    expect(entry.expiresMs).toBeGreaterThanOrEqual(before + DEVICE_STORE_TTL_MS);
    expect(entry.expiresMs).toBeLessThanOrEqual(Date.now() + DEVICE_STORE_TTL_MS);
  });
});

describe("parseDeviceAuthorizationResponse (POST /cli/device-authorizations)", () => {
  it("reads the probed 201 fields", () => {
    const parsed = parseDeviceAuthorizationResponse(SAMPLE_DEVICE);

    expect(parsed.ok).toBe(true);
    expect(parsed.device).toMatchObject({
      deviceId: DEVICE_ID,
      userCode: USER_CODE,
      deviceSecret: DEVICE_SECRET,
      expiresAt: EXPIRES_AT,
      intervalMs: 2000,
    });
    expect(parsed.device.activationUrl).toContain("open-design.ai/cloud/cli/activate");
  });

  it("clamps a hostile or missing poll interval", () => {
    const fast = parseDeviceAuthorizationResponse({ ...SAMPLE_DEVICE, pollIntervalSeconds: 0.05 });
    expect(fast.ok).toBe(true);
    expect(fast.device.intervalMs).toBe(1000);

    const slow = parseDeviceAuthorizationResponse({ ...SAMPLE_DEVICE, pollIntervalSeconds: 3600 });
    expect(slow.ok).toBe(true);
    expect(slow.device.intervalMs).toBe(30000);

    const missing = parseDeviceAuthorizationResponse({ ...SAMPLE_DEVICE, pollIntervalSeconds: undefined });
    expect(missing.ok).toBe(true);
    expect(missing.device.intervalMs).toBe(2500);
  });

  for (const field of ["deviceId", "userCode", "deviceSecret", "activationUrl"]) {
    it(`rejects a response missing ${field}`, () => {
      const body = { ...SAMPLE_DEVICE };
      delete body[field];
      const parsed = parseDeviceAuthorizationResponse(body);

      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain(field);
    });
  }

  it("rejects blank strings as if absent", () => {
    const parsed = parseDeviceAuthorizationResponse({ ...SAMPLE_DEVICE, deviceSecret: "   " });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("deviceSecret");
  });

  it("rejects a non-object body", () => {
    expect(parseDeviceAuthorizationResponse(null).ok).toBe(false);
    expect(parseDeviceAuthorizationResponse("nope").ok).toBe(false);
    expect(parseDeviceAuthorizationResponse([]).ok).toBe(false);
  });
});

describe("parseDeviceTokenResponse (POST /{deviceId}/token)", () => {
  it("pending never yields a key", () => {
    const parsed = parseDeviceTokenResponse(SAMPLE_TOKEN_PENDING);

    expect(parsed).toEqual({ status: "pending" });
    expect(parsed.controlKey).toBeUndefined();
  });

  it("approved with a valid vela_ctrl_ key yields the key", () => {
    const parsed = parseDeviceTokenResponse(SAMPLE_TOKEN_APPROVED);

    expect(parsed.status).toBe("approved");
    expect(parsed.controlKey).toBe(CONTROL_KEY);
    expect(parsed.email).toBe("probe@example.invalid");
    // The runtime key is the connection's apiKey lane — this flow ignores it.
    expect(parsed.runtimeKey).toBeUndefined();
  });

  it("approved without a controlKey is treated as still pending", () => {
    expect(parseDeviceTokenResponse({ ...SAMPLE_TOKEN_APPROVED, controlKey: null })).toEqual({ status: "pending" });
    expect(parseDeviceTokenResponse({ ...SAMPLE_TOKEN_APPROVED, controlKey: undefined })).toEqual({ status: "pending" });
  });

  it("approved with a wrongly-prefixed key is an error, not a save", () => {
    for (const bad of [
      "sk-amr-probe-runtime",
      "ctrl_probe0123456789",
      "vela_ctrl",
      "vela_ctrl_",
      "VELA_CTRL_FIXTUREPLACEHOLDER",
      "vela_ctrl_fixture 0123",
      "vela_ctrl_fixture\n0123",
      `  ${CONTROL_KEY}`,
      `${CONTROL_KEY}  `,
    ]) {
      const parsed = parseDeviceTokenResponse({ ...SAMPLE_TOKEN_APPROVED, controlKey: bad });
      expect(parsed.status).toBe("error");
      expect(parsed.controlKey).toBeUndefined();
    }
  });

  it("non-string approved status is a plain error", () => {
    const parsed = parseDeviceTokenResponse({ ...SAMPLE_TOKEN_APPROVED, controlKey: 12345 });
    expect(parsed.status).toBe("error");
  });

  it("maps denied / expired / unknown statuses", () => {
    expect(parseDeviceTokenResponse({ status: "denied" })).toEqual({ status: "denied" });
    expect(parseDeviceTokenResponse({ status: "expired" })).toEqual({ status: "expired" });
    expect(parseDeviceTokenResponse({ status: "weird" }).status).toBe("unknown");
    expect(parseDeviceTokenResponse({}).status).toBe("error");
    expect(parseDeviceTokenResponse(null).status).toBe("error");
  });
});

describe("isValidControlKey", () => {
  it("accepts a vela_ctrl_ token", () => {
    expect(isValidControlKey(CONTROL_KEY)).toBe(true);
  });

  it("rejects runtime keys, whitespace and non-strings", () => {
    expect(isValidControlKey("sk-amr-x")).toBe(false);
    expect(isValidControlKey("vela_ctrl_a b")).toBe(false);
    expect(isValidControlKey("vela_ctrl_ab")).toBe(false);
    expect(isValidControlKey("")).toBe(false);
    expect(isValidControlKey(null)).toBe(false);
  });
});

describe("network legs against a stubbed fetch", () => {
  it("requestDeviceAuthorization keeps the secret server-side", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe(DEVICE_AUTH_URL);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ cliVersion: "0.0.33", host: "9router", profile: "prod" });
      return jsonResponse(SAMPLE_DEVICE, 201);
    });

    const result = await requestDeviceAuthorization({ connectionId: CONNECTION_ID, fetchImpl });

    expect(result.ok).toBe(true);
    // The returned device carries activation data for the UI...
    expect(result.device).toMatchObject({ deviceId: DEVICE_ID, userCode: USER_CODE, intervalMs: 2000 });
    // ...but the secret only lives in the store.
    expect(getDeviceAuthorization(CONNECTION_ID, DEVICE_ID).deviceSecret).toBe(DEVICE_SECRET);
  });

  it("requestDeviceAuthorization reports an HTTP failure without throwing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, 503));
    const result = await requestDeviceAuthorization({ connectionId: CONNECTION_ID, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("503");
    expect(getDeviceAuthorizationCount()).toBe(0);
  });

  it("poll while pending answers pending and keeps the entry", async () => {
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: EXPIRES_AT,
      intervalMs: 2000,
    });

    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe(`${DEVICE_AUTH_URL}/${DEVICE_ID}/token`);
      // The poll body is built from the store, never from the client.
      expect(JSON.parse(init.body)).toEqual({ deviceSecret: DEVICE_SECRET, userCode: USER_CODE });
      return jsonResponse(SAMPLE_TOKEN_PENDING);
    });

    const result = await pollDeviceAuthorizationToken({ connectionId: CONNECTION_ID, deviceId: DEVICE_ID, fetchImpl });

    expect(result).toEqual({ ok: true, status: "pending" });
    expect(getDeviceAuthorization(CONNECTION_ID, DEVICE_ID)).not.toBeNull();
  });

  it("poll after approval returns the key once and drops the entry", async () => {
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: EXPIRES_AT,
    });

    const fetchImpl = vi.fn(async () => jsonResponse(SAMPLE_TOKEN_APPROVED));
    const result = await pollDeviceAuthorizationToken({ connectionId: CONNECTION_ID, deviceId: DEVICE_ID, fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("approved");
    expect(result.controlKey).toBe(CONTROL_KEY);
    // Single-use: a replayed poll cannot re-save the key.
    expect(getDeviceAuthorization(CONNECTION_ID, DEVICE_ID)).toBeNull();
  });

  it("poll for an unknown device fails closed with 410", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SAMPLE_TOKEN_APPROVED));
    const result = await pollDeviceAuthorizationToken({ connectionId: CONNECTION_ID, deviceId: DEVICE_ID, fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(410);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("poll rejects a bad key without deleting the entry on parse", async () => {
    putDeviceAuthorization({
      connectionId: CONNECTION_ID,
      deviceId: DEVICE_ID,
      deviceSecret: DEVICE_SECRET,
      userCode: USER_CODE,
      expiresAt: EXPIRES_AT,
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...SAMPLE_TOKEN_APPROVED, controlKey: "sk-amr-wrong-lane" }));
    const result = await pollDeviceAuthorizationToken({ connectionId: CONNECTION_ID, deviceId: DEVICE_ID, fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("error");
    expect(result.controlKey).toBeUndefined();
  });
});
