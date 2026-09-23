// `cp .env.example .env` used to sign dashboard sessions with the published example
// JWT_SECRET, so anyone could mint a valid auth_token cookie (GHSA-jphh class).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";

let tmpDir;

vi.mock("@/lib/dataDir", () => ({
  get DATA_DIR() {
    return tmpDir;
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOC_ROOTS = [".env.example", "README.md", "README.zh-CN.md", "DOCKER.md", "docker-compose.yml", "i18n", "gitbook", "docs"];

// Literal `JWT_SECRET=value` / `JWT_SECRET: value` examples across shipped docs → Map(value → file).
// Generated forms ($(openssl ...), <placeholder>) and empty values are skipped.
function scanDocExamples(name) {
  const files = [];
  for (const root of DOC_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) { files.push(abs); continue; }
    for (const rel of fs.readdirSync(abs, { recursive: true })) {
      const p = path.join(abs, rel);
      if (/\.(md|ya?ml|example)$/i.test(p) && fs.statSync(p).isFile()) files.push(p);
    }
  }
  const found = new Map();
  const re = new RegExp(`\\b${name}[ \\t]*[=:][ \\t]*["']?([^"'\\s\`]*)`, "g");
  for (const file of files) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(re)) {
      if (m[1] && !/^[$<]/.test(m[1])) found.set(m[1], path.relative(REPO_ROOT, file));
    }
  }
  return found;
}

async function forge(secret) {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(new TextEncoder().encode(secret));
}

async function loadSession(jwtSecret) {
  vi.resetModules();
  if (jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwtSecret;
  return await import("../../src/lib/auth/dashboardSession.js");
}

describe("dashboard JWT secret", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-jwt-"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not accept tokens forged with the .env.example placeholder", async () => {
    const session = await loadSession("change-me-to-a-long-random-secret");

    expect(await session.verifyDashboardAuthToken(await forge("change-me-to-a-long-random-secret"))).toBe(false);
    // Falls back to the persisted random secret rather than failing closed at boot.
    expect(fs.existsSync(path.join(tmpDir, "jwt-secret"))).toBe(true);
    expect(await session.verifyDashboardAuthToken(await session.createDashboardAuthToken())).toBe(true);
  });

  it("rejects every documented placeholder", async () => {
    const { isPlaceholderJwtSecret } = await loadSession(undefined);

    for (const value of ["your-secure-secret-change-this", "your-secure-secret", "your-secret", "generated-secret-here"]) {
      expect(isPlaceholderJwtSecret(value), value).toBe(true);
    }
  });

  // Keeps the denylist honest: a new JWT_SECRET example added to any doc must also be
  // added to PLACEHOLDER_JWT_SECRETS, or this fails.
  it("covers every literal JWT_SECRET example shipped in the repo docs", async () => {
    const { isPlaceholderJwtSecret } = await loadSession(undefined);
    const examples = scanDocExamples("JWT_SECRET");

    expect(examples.size).toBeGreaterThan(0);
    for (const [value, file] of examples) {
      expect(isPlaceholderJwtSecret(value), `${value} (${file})`).toBe(true);
    }
  });

  it("keeps honoring a real operator-supplied JWT_SECRET", async () => {
    const secret = "f3b1c9e2-operator-chosen-secret-7d41a0";
    const session = await loadSession(secret);

    expect(await session.verifyDashboardAuthToken(await forge(secret))).toBe(true);
  });
});
