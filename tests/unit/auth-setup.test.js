import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate DATA_DIR before anything imports it (dataDir.js reads it at module load).
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "10r-setup-test-"));
process.env.DATA_DIR = TMP_DATA_DIR;
delete process.env.INITIAL_PASSWORD;

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  isOidcConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/lib/db/helpers/metaStore.js", () => ({
  getMeta: mocks.getMeta,
  setMeta: mocks.setMeta,
}));

vi.mock("@/lib/auth/oidc", () => ({
  isOidcConfigured: mocks.isOidcConfigured,
}));

const {
  getAuthBootstrapState,
  getBootstrapSecret,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
  LEGACY_DEFAULT_PASSWORD,
} = await import("../../src/lib/auth/setupState.js");

const {
  issueSetupToken,
  consumeSetupToken,
  verifySetupToken,
  clearSetupToken,
  getSetupTokenState,
  hasMintedThisProcess,
  __resetMintStateForTests,
  SETUP_WINDOW_MS,
} = await import("../../src/lib/auth/setupToken.js");

const { ensureSetupToken } = await import("../../src/lib/auth/setupBootstrap.js");

const TOKEN_FILE = path.join(TMP_DATA_DIR, "setup-token.json");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  delete process.env.INITIAL_PASSWORD;
  mocks.getMeta.mockResolvedValue("0");
  mocks.isOidcConfigured.mockReturnValue(false);
  clearSetupToken();
  __resetMintStateForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auth bootstrap state", () => {
  it("is 'setup' for a fresh install — no default password exists", async () => {
    expect(await getAuthBootstrapState({ authMode: "password" })).toBe("setup");
    expect(await getBootstrapSecret({ authMode: "password" })).toBeNull();
  });

  it("is 'configured' once a hash is stored", async () => {
    expect(await getAuthBootstrapState({ password: "$2a$10$hash" })).toBe("configured");
  });

  it("is 'legacy' when the DB stamped the pre-setup grace flag", async () => {
    mocks.getMeta.mockResolvedValue("1");
    expect(await getAuthBootstrapState({ authMode: "password" })).toBe("legacy");
    expect(await getBootstrapSecret({ authMode: "password" })).toBe(LEGACY_DEFAULT_PASSWORD);
  });

  it("honours a strong INITIAL_PASSWORD as a headless bootstrap", async () => {
    process.env.INITIAL_PASSWORD = "a-strong-bootstrap-pw";
    expect(await getAuthBootstrapState({ authMode: "password" })).toBe("env");
    expect(await getBootstrapSecret({ authMode: "password" })).toBe("a-strong-bootstrap-pw");
  });

  it("ignores a too-short INITIAL_PASSWORD and falls back to setup", async () => {
    process.env.INITIAL_PASSWORD = "short";
    expect(await getAuthBootstrapState({ authMode: "password" })).toBe("setup");
  });

  it("ignores INITIAL_PASSWORD set to the old default", async () => {
    process.env.INITIAL_PASSWORD = LEGACY_DEFAULT_PASSWORD;
    expect(await getAuthBootstrapState({ authMode: "password" })).toBe("setup");
  });

  it("does not demand setup when OIDC is the configured auth mode", async () => {
    mocks.isOidcConfigured.mockReturnValue(true);
    expect(await getAuthBootstrapState({ authMode: "oidc" })).toBe("oidc");
  });
});

describe("password policy", () => {
  it(`rejects passwords under ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(validateNewPassword("1234567").ok).toBe(false);
    expect(validateNewPassword(LEGACY_DEFAULT_PASSWORD).ok).toBe(false);
    expect(validateNewPassword("").ok).toBe(false);
    expect(validateNewPassword(undefined).ok).toBe(false);
  });

  it("accepts a long enough password", () => {
    expect(validateNewPassword("12345678").ok).toBe(true);
  });
});

describe("setup token", () => {
  it("writes an owner-only token file and verifies the exact value", () => {
    const token = issueSetupToken();
    expect(token).toHaveLength(32);
    expect(verifySetupToken(token).ok).toBe(true);
    expect(verifySetupToken(`${token}x`).ok).toBe(false);
    expect(verifySetupToken("").ok).toBe(false);

    if (process.platform !== "win32") {
      expect(fs.statSync(TOKEN_FILE).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects a token past the setup window", () => {
    const token = issueSetupToken();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SETUP_WINDOW_MS + 1000);

    expect(verifySetupToken(token)).toEqual({ ok: false, reason: "expired" });
    expect(getSetupTokenState().expired).toBe(true);
  });

  it("reports no token once cleared", () => {
    issueSetupToken();
    clearSetupToken();
    expect(getSetupTokenState().present).toBe(false);
    expect(verifySetupToken("anything")).toEqual({ ok: false, reason: "missing" });
  });

  it("mints a distinct token each time (restart reopens the window)", () => {
    const first = issueSetupToken();
    const second = issueSetupToken();
    expect(second).not.toBe(first);
    expect(verifySetupToken(first).ok).toBe(false);
    expect(verifySetupToken(second).ok).toBe(true);
  });
});

describe("consumeSetupToken", () => {
  it("verifies and consumes in one step so a token cannot be claimed twice", () => {
    const token = issueSetupToken();

    expect(consumeSetupToken(token).ok).toBe(true);
    // A second concurrent claim finds it already gone.
    expect(consumeSetupToken(token)).toEqual({ ok: false, reason: "missing" });
    expect(getSetupTokenState().present).toBe(false);
  });

  it("leaves the token intact when the candidate is wrong", () => {
    const token = issueSetupToken();

    expect(consumeSetupToken("not-the-token").ok).toBe(false);
    expect(getSetupTokenState().present).toBe(true);
    expect(consumeSetupToken(token).ok).toBe(true);
  });

  it("does not consume an expired token", () => {
    const token = issueSetupToken();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SETUP_WINDOW_MS + 1000);

    expect(consumeSetupToken(token)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("ensureSetupToken", () => {
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({ authMode: "password" });
  });

  it("mints and prints a token for an unclaimed instance", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const token = await ensureSetupToken();

    expect(token).toBeTruthy();
    expect(verifySetupToken(token).ok).toBe(true);
    const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toContain(token);
    expect(printed).toContain("/setup");
    log.mockRestore();
  });

  it("replaces a stale token from a previous run on the first call of a process", async () => {
    const stale = issueSetupToken();
    __resetMintStateForTests(); // simulates a server restart

    const fresh = await ensureSetupToken();

    expect(fresh).not.toBe(stale);
    expect(verifySetupToken(stale).ok).toBe(false);
    expect(verifySetupToken(fresh).ok).toBe(true);
  });

  it("never mints twice in one process — repeat calls cannot refresh the window", async () => {
    const first = await ensureSetupToken();

    expect(await ensureSetupToken()).toBeNull();
    expect(verifySetupToken(first).ok).toBe(true);
  });

  it("does not invalidate a token another path just issued (CLI password reset)", async () => {
    const fromReset = issueSetupToken();

    expect(await ensureSetupToken()).toBeNull();
    expect(verifySetupToken(fromReset).ok).toBe(true);
  });

  it("clears any leftover token once the instance is claimed", async () => {
    issueSetupToken();
    mocks.getSettings.mockResolvedValue({ password: "$2a$10$hash" });

    expect(await ensureSetupToken()).toBeNull();
    expect(getSetupTokenState().present).toBe(false);
  });

  it("does not mint for a legacy install (it still has a way in)", async () => {
    mocks.getMeta.mockResolvedValue("1");

    expect(await ensureSetupToken()).toBeNull();
    expect(hasMintedThisProcess()).toBe(false);
    expect(getSetupTokenState().present).toBe(false);
  });
});
