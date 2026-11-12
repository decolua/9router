/**
 * DF-9ROUTER-36 — account-rotation disclosure.
 *
 * A dogfood run measured the real behaviour of account selection with two
 * connections on ONE provider: 4 consecutive requests were served 4/4 by the
 * connection created last — fill-first, not rotation. Rotation is real but
 * opt-in (`src/sse/services/auth.js:139-140`), so the README must not read as
 * if it were always on.
 *
 * What this file pins, offline:
 *   1. README truthfulness — no line claims rotation as an unconditional
 *      default, and the enablement section names the settings key
 *      (`providerStrategies` / `fallbackStrategy`) and the concrete call.
 *   2. The behaviour the doc now describes — the real selection code resolves
 *      `fill-first` when nothing is configured and only rotates when a
 *      per-provider override is present.
 *   3. The documented example — the PATCH body quoted in the README parses into
 *      the shape the settings layer accepts.
 *
 * Mocks (deliberately minimal — `getProviderCredentials` is the seam that
 * decides the strategy, so we import the REAL auth module and fake only what
 * reaches the outside world): `@/lib/localDb` (connections + settings), the
 * connection-proxy resolver, the provider-constants map, the logger, and the
 * settings repo's DB driver. No code of the behaviour under test is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const README = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
const README_LINES = README.split("\n");
const AUTH_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "src", "sse", "services", "auth.js"),
  "utf8",
);
const SETTINGS_REPO_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "src", "lib", "db", "repos", "settingsRepo.js"),
  "utf8",
);

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  storedData: { value: null },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(async () => []),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(() => null),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
// settingsRepo's own DB handle. `mergeWithDefaults` is pure, so the adapter is
// never called here; mocking it keeps this file off the SQLite path entirely.
vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({
    get: vi.fn(() =>
      mocks.storedData.value === null ? undefined : { data: mocks.storedData.value },
    ),
  })),
}));

// The README half of this file is the primary deliverable, so a broken import
// of the (DB-adjacent) auth module must not take the documentation tests down
// with it: import defensively and fail the behaviour tests with a loud reason.
let auth = null;
let authImportError = null;
try {
  auth = await import("@/sse/services/auth.js");
} catch (error) {
  authImportError = error;
}

function requireAuthModule() {
  if (!auth) {
    throw new Error(
      `src/sse/services/auth.js could not be imported in this environment: ${authImportError?.message}`,
    );
  }
}

const { mergeWithDefaults } = await import("../../src/lib/db/repos/settingsRepo.js");

const PROVIDER_ID = "openai-compatible-chat-412551d5-0000-0000-0000-000000000000";
const MODEL = "lmstudio/qwen3.5-4b";

// A connection that is available for this model: no model lock, active, with a
// stable priority. `useCount`/`lastUsedAt` let a test make one account the most
// recently used one, which is what the round-robin branch reads.
function connection(id, priority, { lastUsedAt = null, consecutiveUseCount = 0 } = {}) {
  return {
    id,
    priority,
    isActive: true,
    authType: "apikey",
    apiKey: "sk-test",
    lastUsedAt,
    consecutiveUseCount,
    providerSpecificData: {},
  };
}

/** The strategy literal the real selection code falls back to. */
const DEFAULT_STRATEGY_EXPR =
  /const strategy = providerOverride\.fallbackStrategy \|\| settings\.fallbackStrategy \|\| "([a-z-]+)"/.exec(
    AUTH_SRC,
  )?.[1] || null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storedData.value = null;
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
  mocks.updateProviderConnection.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. README truthfulness
// ─────────────────────────────────────────────────────────────────────────────

describe("README — the account-rotation default is stated truthfully", () => {
  const FEATURE_BULLET_PHRASE = "Round-robin between accounts per provider";
  // Any line that names the rotation feature has to say it is conditional.
  // Phrase-level on purpose: wording and layout may change freely.
  const CONDITIONAL_MARKERS = [
    "configurable",
    "opt-in",
    "opt in",
    "optional",
    "per provider",
    "on request",
    "when enabled",
    "if enabled",
    "available",
  ];

  it("no bullet advertising provider round-robin reads as an unconditional default", () => {
    // Presence of the feature is asserted by the companion tests below (the
    // feature-detail bullet and the enablement section), so this check stays
    // phrase-level and does not need a non-empty premise of its own.
    const rotationBullets = README_LINES.map((line, index) => ({ line, no: index + 1 })).filter(
      ({ line }) => /^\s*-\s/.test(line) && /round-?robin/i.test(line),
    );

    for (const { line, no } of rotationBullets) {
      const qualified = CONDITIONAL_MARKERS.some(
        (marker) => line.replace(FEATURE_BULLET_PHRASE, "").toLowerCase().includes(marker),
      );
      expect(
        qualified,
        `README.md:${no} advertises provider round-robin without saying it is ` +
          `conditional: "${line}" — the default is fill-first ` +
          `(src/sse/services/auth.js:140)`,
      ).toBe(true);
    }
  });

  it("still advertises provider round-robin (narrowing the claim must not delete it)", () => {
    const mentions = README_LINES.filter((line) => /round-?robin/i.test(line));
    expect(
      mentions.length,
      "the rotation feature is real and must stay documented somewhere",
    ).toBeGreaterThan(0);
    expect(README).toMatch(/fallbackStrategy/);
  });

  it("keeps the landing feature list as bullets (no paragraph rewrite)", () => {
    const bullet = README_LINES.find((line) => line.includes("**Multi-account**"));
    expect(bullet).toBeTruthy();
    expect(bullet.trim().startsWith("-")).toBe(true);
  });

  it("the feature-details section says fill-first is the default and rotation is opt-in", () => {
    const bullet = README_LINES.find((line) =>
      line.includes("routing by default") && line.toLowerCase().includes("fill-first"),
    );
    expect(
      bullet,
      "the Multi-Account Support feature list must state the fill-first default",
    ).toBeTruthy();
    expect(bullet.toLowerCase()).toMatch(/round-robin is opt-in|opt-in per provider/);
  });
});

describe("README — the provider id used in the example is a real id shape", () => {
  // The documented PATCH keys on a provider/node id. A compatible node's id is
  // built as `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${generateId()}` (see
  // src/app/api/provider-nodes/route.js), which is what makes the LM Studio
  // node id in the walkthrough a legal key for `providerStrategies`.
  const PROVIDER_NODES_SRC = fs.readFileSync(
    path.join(REPO_ROOT, "src", "app", "api", "provider-nodes", "route.js"),
    "utf8",
  );
  const CONSTANTS_SRC = fs.readFileSync(
    path.join(REPO_ROOT, "src", "shared", "constants", "providers.js"),
    "utf8",
  );

  it("the example node id matches the id the provider-nodes route generates", () => {
    const prefix = /OPENAI_COMPATIBLE_PREFIX = "([^"]+)"/.exec(CONSTANTS_SRC)?.[1];
    const generator = /id: `\$\{OPENAI_COMPATIBLE_PREFIX\}\$\{apiType\}-/.test(PROVIDER_NODES_SRC);

    expect(prefix).toBe("openai-compatible-");
    expect(generator, "provider-nodes ids must still be prefix+apiType+uuid").toBe(true);

    // The id quoted in the README walkthrough (and re-quoted in the new section)
    // must satisfy that shape, or the documented key would be wrong.
    const documented = README.match(/openai-compatible-chat-[0-9a-f-]+/)?.[0];
    expect(documented, "the walkthrough must show a concrete node id").toBeTruthy();
    expect(documented.startsWith(prefix)).toBe(true);
    expect(documented).toMatch(/^openai-compatible-chat-[0-9a-f-]{8,}$/);
  });
});

describe("README — how to enable rotation is documented", () => {
  function section(headingPattern) {
    const lines = README_LINES;
    const start = lines.findIndex((line) => headingPattern.test(line));
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,4} /.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n");
  }

  const rotationSection = section(/^#{2,4} .*fill-first.*default/i);
  const patchBody = /-d '(\{"providerStrategies".*?\})'/.exec(README)?.[1] || null;

  it("has an enablement subsection that names fill-first as the default", () => {
    expect(
      rotationSection,
      "README needs a subsection documenting that fill-first is the default and how to switch",
    ).toBeTruthy();
    expect(rotationSection).toMatch(/fill-first/);
    expect(rotationSection.toLowerCase()).toMatch(/default/);
    expect(rotationSection.toLowerCase()).toMatch(/opt-in/);
  });

  it("names the settings key and the concrete PATCH call", () => {
    expect(rotationSection).toMatch(/providerStrategies/);
    expect(rotationSection).toMatch(/fallbackStrategy/);
    expect(rotationSection).toMatch(/PATCH .*\/api\/settings/);
    expect(rotationSection).toMatch(/round-robin/);
  });

  it("quotes a PATCH body that parses into the documented settings shape", () => {
    expect(patchBody, "the enablement section must quote the exact PATCH body").toBeTruthy();

    const parsed = JSON.parse(patchBody);
    expect(Object.keys(parsed)).toEqual(["providerStrategies"]);

    const entries = Object.entries(parsed.providerStrategies);
    expect(entries).toHaveLength(1);
    const [providerId, override] = entries[0];
    expect(providerId).toBe("<provider-id>");
    expect(override).toEqual({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 });
  });

  it("the documented body is accepted by the real settings merge (same key path)", () => {
    const parsed = JSON.parse(patchBody);
    const settings = mergeWithDefaults(parsed);
    expect(settings.providerStrategies["<provider-id>"].fallbackStrategy).toBe("round-robin");
    expect(settings.providerStrategies["<provider-id>"].stickyRoundRobinLimit).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Behaviour pin — the default really is fill-first
// ─────────────────────────────────────────────────────────────────────────────

describe("account selection — fill-first by default, rotation only when configured", () => {
  it("auth.js resolves the strategy default to fill-first (a flip is out of scope)", () => {
    expect(DEFAULT_STRATEGY_EXPR).toBe("fill-first");
  });

  it("a fresh install has no provider override and no rotation pre-enabled", () => {
    const fresh = mergeWithDefaults({});
    expect(fresh.providerStrategies).toEqual({});
    // Rotation is a per-provider setting; nothing enables it globally for a new
    // install, which is what makes "fill-first" the effective default.
    expect(fresh.stickyRoundRobinLimit).toBe(3);
  });

  it("no rotation default was flipped into DEFAULT_SETTINGS (the task's out-of-scope change)", () => {
    // The disclosure fix must not have changed behaviour for existing installs:
    // `fallbackStrategy` must still be ABSENT from the defaults, so the
    // resolution falls through to the "fill-first" literal in auth.js rather
    // than to a newly-invented stored default.
    expect(Object.prototype.hasOwnProperty.call(mergeWithDefaults({}), "fallbackStrategy")).toBe(
      false,
    );

    const defaults = /const DEFAULT_SETTINGS = \{([\s\S]*?)\n\};/.exec(SETTINGS_REPO_SRC)?.[1] || "";
    expect(defaults).not.toMatch(/fallbackStrategy\s*:/);
    expect(defaults).toMatch(/providerStrategies:\s*\{\}/);
  });

  it("picks the priority-first connection when nothing is configured (fill-first)", async () => {
    requireAuthModule();
    mocks.getSettings.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([
      connection("conn-a", 1, { lastUsedAt: "2026-09-01T00:00:00.000Z", consecutiveUseCount: 3 }),
      connection("conn-b", 2, { lastUsedAt: "2026-09-19T00:00:00.000Z", consecutiveUseCount: 0 }),
    ]);

    const creds = await auth.getProviderCredentials(PROVIDER_ID, null, MODEL);

    // conn-b is the most recently used account — rotation would have picked it;
    // fill-first keeps the highest-priority account.
    expect(creds.connectionId).toBe("conn-a");
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("rotates to the least-recently-used connection once a provider override exists", async () => {
    requireAuthModule();
    mocks.getSettings.mockResolvedValue({
      providerStrategies: {
        [PROVIDER_ID]: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 },
      },
    });
    mocks.getProviderConnections.mockResolvedValue([
      connection("conn-a", 1, { lastUsedAt: "2026-09-01T00:00:00.000Z", consecutiveUseCount: 3 }),
      connection("conn-b", 2, { lastUsedAt: "2026-09-19T00:00:00.000Z", consecutiveUseCount: 0 }),
    ]);

    const creds = await auth.getProviderCredentials(PROVIDER_ID, null, MODEL);

    // Same two connections, same order — the override is the only difference.
    expect(creds.connectionId).toBe("conn-b");
    expect(mocks.updateProviderConnection).toHaveBeenCalled();
  });
});
