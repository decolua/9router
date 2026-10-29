// MiniMax Code lease auth mode — named-pipe broker protocol (frame codec,
// endpoint resolution), the in-process lease cache, and the executor wiring
// that borrows desktop tokens for authType "mcode-lease" connections.
// Protocol ported from MiniMax-AI/minimax-code packages/oauth-lease-protocol (MIT).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";

// ── pure protocol module (no app deps) ───────────────────────────────────────
import {
  AUTH_LEASE_MAX_FRAME_BYTES,
  AuthLeaseError,
  DEFAULT_MCODE_DATA_DIR,
  FrameDecoder,
  createTokenManager,
  encodeFrame,
  isLeaseConnection,
  resolveLeaseEndpoint,
  resolveMcodeDataDir,
} from "../../open-sse/services/minimaxCodeLease.js";

// ── executor under test (stub base + mocked refresh/lease imports) ───────────
class StubBase {
  constructor(provider) { this.provider = provider; }
  async execute(args) {
    StubBase.lastArgs = args;
    return { response: new Response("{}", { status: 200 }) };
  }
}
vi.mock("../../open-sse/executors/default.js", () => ({ DefaultExecutor: StubBase }));

const refreshMiniMaxMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshMiniMaxCodeToken: refreshMiniMaxMock,
}));

// Partial mock: keep the real protocol/codec/helpers, replace only the broker
// I/O the executor touches.
const getLeaseTokenMock = vi.hoisted(() => vi.fn());
const invalidateLeaseTokenMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/services/minimaxCodeLease.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getLeaseToken: getLeaseTokenMock,
  invalidateLeaseToken: invalidateLeaseTokenMock,
}));

const { MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js");

describe("lease wire protocol: frame codec", () => {
  it("round-trips a JSON payload through the 4-byte length prefix", () => {
    const frame = encodeFrame({ version: 1, method: "lease", minValidityMs: 300000 });
    expect(frame.length).toBe(4 + frame.length - 4);
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);

    const decoder = new FrameDecoder();
    expect(decoder.push(frame)).toEqual([{ version: 1, method: "lease", minValidityMs: 300000 }]);
  });

  it("reassembles frames split across chunks and concatenates siblings", () => {
    const decoder = new FrameDecoder();
    const a = encodeFrame({ ok: true });
    const b = encodeFrame({ ok: false, error: { code: "AUTH_REQUIRED" } });

    expect(decoder.push(a.subarray(0, 2))).toEqual([]);
    expect(decoder.push(Buffer.concat([a.subarray(2), b.subarray(0, 5)]))).toEqual([{ ok: true }]);
    expect(decoder.push(b.subarray(5))).toEqual([{ ok: false, error: { code: "AUTH_REQUIRED" } }]);
  });

  it("rejects out-of-bounds payloads and non-JSON frames", () => {
    expect(() => encodeFrame({ big: "x".repeat(AUTH_LEASE_MAX_FRAME_BYTES) })).toThrow(AuthLeaseError);

    const bad = Buffer.alloc(8);
    bad.writeUInt32BE(0, 0);
    expect(() => new FrameDecoder().push(bad)).toThrow(/invalid frame length/);

    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(AUTH_LEASE_MAX_FRAME_BYTES + 1, 0);
    expect(() => new FrameDecoder().push(oversized)).toThrow(/invalid frame length/);

    const notJson = Buffer.alloc(4 + 4);
    notJson.writeUInt32BE(4, 0);
    notJson.write("nope", 4);
    expect(() => new FrameDecoder().push(notJson)).toThrow(/non-JSON/);
  });
});

describe("lease endpoint resolution", () => {
  it("hashes the normalized, lowercased win32 data dir into the pipe name", () => {
    const forward = resolveLeaseEndpoint("C:/Users/u/.MiniMax", "win32");
    const backward = resolveLeaseEndpoint("C:\\Users\\u\\.MiniMax\\", "win32");
    expect(forward).toEqual(backward);

    const digest = createHash("sha256").update("c:\\users\\u\\.minimax").digest("hex").slice(0, 16);
    expect(forward.endpoint).toBe(`\\\\.\\pipe\\mcode-auth-lease-${digest}`);
    expect(forward.capabilityFile).toBe("C:\\Users\\u\\.MiniMax\\run\\mcode-auth-lease-v1.cap");
  });

  it("puts the unix socket and capability file under <dataDir>/run", () => {
    const ep = resolveLeaseEndpoint("/home/u/.minimax", "linux");
    expect(ep.transport).toBe("unix");
    // path.join follows the host — on a Linux broker host this is the posix form.
    expect(ep.endpoint).toBe(path.join("/home/u/.minimax", "run", "mcode-auth-lease-v1.sock"));
    expect(ep.capabilityFile).toBe(path.join("/home/u/.minimax", "run", "mcode-auth-lease-v1.cap"));
  });

  it("refuses relative data dirs", () => {
    expect(() => resolveLeaseEndpoint("relative/path", "win32")).toThrow(AuthLeaseError);
    expect(() => resolveLeaseEndpoint("relative/path", "linux")).toThrow(AuthLeaseError);
  });
});

describe("lease token manager", () => {
  beforeEach(() => vi.clearAllMocks());

  function managerWith(tokens, delayMs = 0) {
    let calls = 0;
    const leaseFn = vi.fn(async () => {
      calls += 1;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return tokens[Math.min(calls - 1, tokens.length - 1)];
    });
    return { manager: createTokenManager({ requestLease: leaseFn }), leaseFn };
  }

  const fresh = (token) => ({ accessToken: token, expiresAtMs: Date.now() + 5 * 60 * 1000, generation: 1 });

  it("caches a lease while it stays fresh (60s margin)", async () => {
    const { manager, leaseFn } = managerWith([fresh("t1")]);
    await manager.getToken("/data");
    await manager.getToken("/data");
    expect(leaseFn).toHaveBeenCalledTimes(1);
  });

  it("re-leases once the remaining validity drops under the margin", async () => {
    const { manager, leaseFn } = managerWith([{ accessToken: "t1", expiresAtMs: Date.now() + 30 * 1000, generation: 1 }, fresh("t2")]);
    await manager.getToken("/data");
    await manager.getToken("/data");
    expect(leaseFn).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent requests into a single lease (single-flight)", async () => {
    const { manager, leaseFn } = managerWith([fresh("t1")], 20);
    const [a, b] = await Promise.all([manager.getToken("/data"), manager.getToken("/data")]);
    expect(a.accessToken).toBe("t1");
    expect(b.accessToken).toBe("t1");
    expect(leaseFn).toHaveBeenCalledTimes(1);
  });

  it("drops the cache on invalidate and leases anew", async () => {
    const { manager, leaseFn } = managerWith([fresh("t1"), fresh("t2")]);
    await manager.getToken("/data");
    manager.invalidate("upstream 401");
    const next = await manager.getToken("/data");
    expect(next.accessToken).toBe("t2");
    expect(leaseFn).toHaveBeenCalledTimes(2);
  });
});

describe("mcode data dir + mode helpers", () => {
  const ORIGINAL_ENV = process.env.MINIMAX_DESKTOP_DATA_DIR;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.MINIMAX_DESKTOP_DATA_DIR;
    else process.env.MINIMAX_DESKTOP_DATA_DIR = ORIGINAL_ENV;
  });

  it("isLeaseConnection keys on the mcode-lease authType", () => {
    expect(isLeaseConnection({ authType: "mcode-lease" })).toBe(true);
    expect(isLeaseConnection({ authType: "oauth", refreshToken: "r" })).toBe(false);
    expect(isLeaseConnection(null)).toBe(false);
  });

  it("resolves the data dir: connection override > env > default", () => {
    process.env.MINIMAX_DESKTOP_DATA_DIR = "/env/dir";
    // resolve() normalizes per host — compare against the same call.
    expect(resolveMcodeDataDir({ providerSpecificData: { mcodeDataDir: "/conn/dir" } })).toBe(path.resolve("/conn/dir"));
    expect(resolveMcodeDataDir({ providerSpecificData: {} })).toBe(path.resolve("/env/dir"));
    delete process.env.MINIMAX_DESKTOP_DATA_DIR;
    expect(resolveMcodeDataDir({})).toBe(DEFAULT_MCODE_DATA_DIR);
  });
});

describe("minimax-code executor lease wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    StubBase.lastArgs = null;
  });

  it("borrows a leased token for lease connections before calling upstream", async () => {
    getLeaseTokenMock.mockResolvedValue({ accessToken: "leased-1", expiresAtMs: Date.now() + 300000, generation: 3 });
    const ex = new MinimaxCodeExecutor("minimax-code");

    await ex.execute({ model: "MiniMax-M3", body: {}, credentials: { authType: "mcode-lease" } });

    expect(getLeaseTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ authType: "mcode-lease" }),
      undefined,
    );
    expect(StubBase.lastArgs.credentials.accessToken).toBe("leased-1");
  });

  it("leaves stored-token (oauth) credentials untouched", async () => {
    const ex = new MinimaxCodeExecutor("minimax-code");
    const creds = { authType: "oauth", accessToken: "stored-1", refreshToken: "r1" };

    await ex.execute({ model: "MiniMax-M3", body: {}, credentials: creds });

    expect(getLeaseTokenMock).not.toHaveBeenCalled();
    expect(StubBase.lastArgs.credentials.accessToken).toBe("stored-1");
  });

  it("refreshes a lease connection by invalidating and re-leasing (no refresh token)", async () => {
    getLeaseTokenMock.mockResolvedValue({ accessToken: "leased-2", expiresAtMs: Date.now() + 300000, generation: 4 });
    const ex = new MinimaxCodeExecutor("minimax-code");

    const out = await ex.refreshCredentials({ authType: "mcode-lease" });

    expect(invalidateLeaseTokenMock).toHaveBeenCalled();
    expect(out).toEqual({ accessToken: "leased-2" });
    expect(refreshMiniMaxMock).not.toHaveBeenCalled();
  });

  it("returns null (fail over) when the desktop broker is unreachable", async () => {
    getLeaseTokenMock.mockRejectedValue(new AuthLeaseError("BROKER_UNAVAILABLE"));
    const ex = new MinimaxCodeExecutor("minimax-code");

    const out = await ex.refreshCredentials({ authType: "mcode-lease" });

    expect(out).toBeNull();
  });

  it("keeps the single-use refresh-token handler for oauth connections", async () => {
    refreshMiniMaxMock.mockResolvedValue({ accessToken: "a", refreshToken: "r2" });
    const ex = new MinimaxCodeExecutor("minimax-code");

    const out = await ex.refreshCredentials({ authType: "oauth", refreshToken: "r1" });

    expect(out).toEqual({ accessToken: "a", refreshToken: "r2" });
    expect(refreshMiniMaxMock).toHaveBeenCalledWith("minimax-code", "r1", undefined);
    expect(getLeaseTokenMock).not.toHaveBeenCalled();
  });
});
