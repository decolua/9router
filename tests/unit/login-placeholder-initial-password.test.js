// A fresh install on the default password must not hand a remote client a session
// (CVE-2026-56679 chain). An INITIAL_PASSWORD copied from .env.example or the docs is
// just as public, so it must not switch that protection off.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  isLocalRequest: vi.fn(),
  setDashboardAuthCookie: vi.fn(async () => {}),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({ authMode: "password" })) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: mocks.setDashboardAuthCookie }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: () => false }));
vi.mock("@/lib/auth/saml.js", () => ({ isSamlConfigured: () => false }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { isPlaceholderInitialPassword } = await import("../../src/lib/auth/initialPassword.js");

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOC_ROOTS = [".env.example", "README.md", "README.zh-CN.md", "DOCKER.md", "docker-compose.yml", "i18n", "gitbook", "docs"];

// Literal INITIAL_PASSWORD examples across shipped docs → Map(value → file).
// Empty values and <placeholders> / $(generated) forms are skipped.
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

let n = 0;
function login(password) {
  // Distinct client IP per call so the lockout limiter never interferes.
  n += 1;
  return POST(new Request("http://router.example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${n}` },
    body: JSON.stringify({ password }),
  }));
}

describe("login with an example INITIAL_PASSWORD", () => {
  const original = process.env.INITIAL_PASSWORD;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRUST_PROXY = "true";
    mocks.isLocalRequest.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
    if (original === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = original;
  });

  it.each(["change-me", "your-password", "your-secure-password"])(
    "refuses a remote session for the documented example %j",
    async (value) => {
      process.env.INITIAL_PASSWORD = value;

      const res = await login(value);

      expect(res.status).toBe(403);
      expect((await res.json()).mustChangePassword).toBe(true);
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    },
  );

  it("still lets the local machine sign in with it (to change it)", async () => {
    process.env.INITIAL_PASSWORD = "change-me";
    mocks.isLocalRequest.mockReturnValue(true);

    const res = await login("change-me");

    expect(res.status).toBe(200);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });

  // A new INITIAL_PASSWORD example in any doc must also be added to the placeholder list.
  it("covers every literal INITIAL_PASSWORD example shipped in the repo docs", () => {
    const examples = scanDocExamples("INITIAL_PASSWORD");

    expect(examples.size).toBeGreaterThan(0);
    for (const [value, file] of examples) {
      expect(isPlaceholderInitialPassword(value), `${value} (${file})`).toBe(true);
    }
  });

  it("keeps allowing remote sign-in with an operator-chosen INITIAL_PASSWORD", async () => {
    process.env.INITIAL_PASSWORD = "k7#Qv9!operator-chosen";

    const res = await login("k7#Qv9!operator-chosen");

    expect(res.status).toBe(200);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });
});
