import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth/dashboardSession", () => ({
  getDashboardAuthSession: vi.fn(),
  shouldUseSecureCookie: vi.fn(() => false),
  deriveInstallId: vi.fn((label, bytes) => new Uint8Array(bytes).fill(label.length)),
}));

const {
  resolveRelyingParty,
  saveChallenge,
  consumeChallenge,
  pendingChallengeCount,
  clearChallenges,
  setChallengeCookie,
  clearChallengeCookie,
  sanitizePasskeyName,
  isValidCredentialId,
  PasskeyError,
  PASSKEY_ORIGIN_ERROR,
  CHALLENGE_TTL_MS,
  MAX_PENDING_CHALLENGES,
  MAX_PENDING_PER_CLIENT,
  getPasskeyUserId,
} = await import("../../src/lib/auth/passkey.js");

function req(headers) {
  return { headers: new Headers(headers) };
}

function expectRejected(fn, message = PASSKEY_ORIGIN_ERROR) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PasskeyError);
  expect(caught.message).toBe(message);
  return caught;
}

describe("resolveRelyingParty", () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.BASE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("accepts an https origin matching Host", () => {
    expect(resolveRelyingParty(req({ origin: "https://router.example.com", host: "router.example.com" })))
      .toEqual({ rpId: "router.example.com", origin: "https://router.example.com" });
  });

  it("keeps a non-default port in the expected origin but not the RP ID", () => {
    expect(resolveRelyingParty(req({ origin: "https://router.example.com:8443", host: "router.example.com:8443" })))
      .toEqual({ rpId: "router.example.com", origin: "https://router.example.com:8443" });
  });

  it("accepts http://localhost and *.localhost", () => {
    expect(resolveRelyingParty(req({ origin: "http://localhost:20128", host: "localhost:20128" })))
      .toEqual({ rpId: "localhost", origin: "http://localhost:20128" });
    expect(resolveRelyingParty(req({ origin: "http://router.localhost:20128", host: "router.localhost:20128" })).rpId)
      .toBe("router.localhost");
  });

  it("rejects IP address origins, even over https", () => {
    expectRejected(() => resolveRelyingParty(req({ origin: "http://127.0.0.1:20128", host: "127.0.0.1:20128" })));
    expectRejected(() => resolveRelyingParty(req({ origin: "https://192.168.1.10", host: "192.168.1.10" })));
    expectRejected(() => resolveRelyingParty(req({ origin: "http://[::1]:20128", host: "[::1]:20128" })));
  });

  it("rejects plain http on a non-localhost domain", () => {
    expectRejected(() => resolveRelyingParty(req({ origin: "http://router.example.com", host: "router.example.com" })));
  });

  it("rejects a missing, opaque or malformed Origin", () => {
    expectRejected(() => resolveRelyingParty(req({ host: "router.example.com" })));
    expectRejected(() => resolveRelyingParty(req({ origin: "null", host: "router.example.com" })));
    expectRejected(() => resolveRelyingParty(req({ origin: "https://router.example.com/path", host: "router.example.com" })));
  });

  it("rejects an Origin that does not match the Host header", () => {
    const error = expectRejected(
      () => resolveRelyingParty(req({ origin: "https://evil.example", host: "router.example.com" })),
      "Passkey request origin does not match this server's host"
    );
    expect(error.status).toBe(403);
  });

  it("ignores X-Forwarded-Host unless TRUST_PROXY is set", () => {
    const headers = { origin: "https://public.example.com", host: "127.0.0.1:20128", "x-forwarded-host": "public.example.com" };
    expectRejected(() => resolveRelyingParty(req(headers)), "Passkey request origin does not match this server's host");

    process.env.TRUST_PROXY = "true";
    expect(resolveRelyingParty(req(headers)).rpId).toBe("public.example.com");
  });

  it("accepts the configured public base URL host behind a Host-rewriting proxy", () => {
    process.env.BASE_URL = "https://public.example.com";
    expect(resolveRelyingParty(req({ origin: "https://public.example.com", host: "127.0.0.1:20128" })).rpId)
      .toBe("public.example.com");
  });
});

describe("passkey challenge store", () => {
  beforeEach(() => clearChallenges());

  const entry = { challenge: "c1", type: "login", rpId: "router.example.com", origin: "https://router.example.com" };

  it("returns a challenge once and only once", () => {
    const id = saveChallenge(entry);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(consumeChallenge(id, "login")).toMatchObject({ challenge: "c1", rpId: "router.example.com" });
    expect(consumeChallenge(id, "login")).toBeNull();
  });

  it("rejects a wrong type and burns the entry anyway", () => {
    const id = saveChallenge(entry);
    expect(consumeChallenge(id, "register")).toBeNull();
    expect(consumeChallenge(id, "login")).toBeNull();
  });

  it("rejects expired challenges", () => {
    const now = 1_000_000;
    const id = saveChallenge(entry, now);
    expect(consumeChallenge(id, "login", now + CHALLENGE_TTL_MS + 1)).toBeNull();
    expect(pendingChallengeCount()).toBe(0);
  });

  it("rejects missing or junk ids", () => {
    expect(consumeChallenge(undefined, "login")).toBeNull();
    expect(consumeChallenge("", "login")).toBeNull();
    expect(consumeChallenge("x".repeat(500), "login")).toBeNull();
  });

  it("prunes expired entries when saving", () => {
    const now = 2_000_000;
    saveChallenge(entry, now);
    saveChallenge(entry, now);
    saveChallenge(entry, now + CHALLENGE_TTL_MS + 1);
    expect(pendingChallengeCount()).toBe(1);
  });

  it("caps the store and evicts the oldest entries", () => {
    const first = saveChallenge(entry);
    for (let i = 0; i < MAX_PENDING_CHALLENGES + 50; i += 1) saveChallenge(entry);
    expect(pendingChallengeCount()).toBe(MAX_PENDING_CHALLENGES);
    expect(consumeChallenge(first, "login")).toBeNull();
  });

  it("lets one client flood only displace its own pending challenges", () => {
    const owner = saveChallenge({ ...entry, client: "198.51.100.7" });
    for (let i = 0; i < MAX_PENDING_CHALLENGES * 3; i += 1) saveChallenge({ ...entry, client: "203.0.113.66" });

    expect(pendingChallengeCount("login")).toBe(1 + MAX_PENDING_PER_CLIENT);
    expect(consumeChallenge(owner, "login")).toMatchObject({ challenge: "c1" });
  });

  it("keeps the newest challenges of a client and drops its oldest", () => {
    const ids = Array.from({ length: MAX_PENDING_PER_CLIENT + 2 }, () => saveChallenge({ ...entry, client: "198.51.100.7" }));

    expect(consumeChallenge(ids[0], "login")).toBeNull();
    expect(consumeChallenge(ids[1], "login")).toBeNull();
    expect(consumeChallenge(ids.at(-1), "login")).not.toBeNull();
  });

  it("falls back to the global bound for the shared 'unknown' bucket", () => {
    for (let i = 0; i < MAX_PENDING_PER_CLIENT * 2; i += 1) saveChallenge({ ...entry, client: "unknown" });
    expect(pendingChallengeCount("login")).toBe(MAX_PENDING_PER_CLIENT * 2);
  });

  it("keeps register challenges out of reach of login traffic", () => {
    const register = saveChallenge({ ...entry, type: "register", client: "198.51.100.7" });
    for (let i = 0; i < MAX_PENDING_CHALLENGES + 50; i += 1) saveChallenge(entry);

    expect(pendingChallengeCount("register")).toBe(1);
    expect(consumeChallenge(register, "register")).toMatchObject({ type: "register" });
  });

  it("is shared through globalThis across module instances", () => {
    const id = saveChallenge(entry);
    expect(globalThis[Symbol.for("9router.passkey.challenges.v2")].login.has(id)).toBe(true);
  });
});

describe("passkey user handle", () => {
  it("uses a per-install handle instead of a constant shared by every install", () => {
    const userId = getPasskeyUserId();
    expect(userId).toBeInstanceOf(Uint8Array);
    expect(userId).toHaveLength(32);
    expect(Buffer.from(userId).toString("utf8")).not.toBe("9router-admin");
  });
});

describe("passkey cookie and input helpers", () => {
  it("sets a strict, httpOnly, path-scoped challenge cookie and clears it on the same path", () => {
    const cookieStore = { set: vi.fn() };
    setChallengeCookie(cookieStore, req({}), "abc");
    expect(cookieStore.set).toHaveBeenCalledWith("passkey_challenge", "abc", expect.objectContaining({
      httpOnly: true,
      sameSite: "strict",
      path: "/api/auth/passkey",
      maxAge: 300,
    }));

    clearChallengeCookie(cookieStore, req({}));
    expect(cookieStore.set).toHaveBeenLastCalledWith("passkey_challenge", "", expect.objectContaining({
      path: "/api/auth/passkey",
      maxAge: 0,
    }));
  });

  it("sanitizes passkey names", () => {
    expect(sanitizePasskeyName("  MacBook  ")).toBe("MacBook");
    expect(sanitizePasskeyName("")).toBe("Passkey");
    expect(sanitizePasskeyName(42)).toBe("Passkey");
    expect(sanitizePasskeyName("a\u0000b\nc")).toBe("abc");
    expect(sanitizePasskeyName("x".repeat(100))).toHaveLength(64);
  });

  it("validates credential ids as base64url", () => {
    expect(isValidCredentialId("AbC-_123")).toBe(true);
    expect(isValidCredentialId("a/b")).toBe(false);
    expect(isValidCredentialId("")).toBe(false);
    expect(isValidCredentialId(null)).toBe(false);
  });
});
