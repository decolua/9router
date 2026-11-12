// Quota Tracker for opendesign-go (control-plane key → amr-api).
// Payloads are the live-probed shapes from 2026-11-12 (real vela_ctrl_ key),
// pinned so a vendor drift breaks here instead of on the dashboard.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const API_BASE = "https://amr-api.open-design.ai/api/v1";
const WORKSPACES_URL = `${API_BASE}/workspaces`;
const WS = "c9cvnjeqq8watiii2r7p3k6g";
const PREFLIGHT_URL = `${API_BASE}/workspaces/${WS}/billing/preflight`;
const BALANCE_URL = `${API_BASE}/workspaces/${WS}/wallet/balance`;
const CONTROL_KEY = "vela_ctrl_test_key";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function planWindow(durationSeconds, usedCredits, limitCredits, resetsAt) {
  return {
    policyId: `policy_${durationSeconds}`,
    durationSeconds,
    resetMode: "anchored_recurring",
    usedCredits,
    limitCredits,
    remainingCredits: (BigInt(limitCredits) - BigInt(usedCredits)).toString(),
    windowStart: "2026-11-11T21:18:32.000Z",
    resetsAt,
  };
}

// Verbatim GET /api/v1/workspaces answer.
const SAMPLE_WORKSPACES = {
  items: [{ workspaceId: WS, name: "default" }],
};

// Verbatim GET /billing/preflight answer (balances trimmed).
const SAMPLE_PREFLIGHT = {
  schemaVersion: 1,
  workspaceId: WS,
  workspaceMemberId: "eo67bhvpdut20r60qivuffrq",
  generatedAt: "2026-11-12T01:01:20.972Z",
  balanceUsd: "1.1000",
  codingPlan: {
    workspaceId: WS,
    eligible: true,
    tier: "go",
    windows: [
      planWindow(18000, "32210", "50000", "2026-11-12T02:18:32.000Z"),
      planWindow(604800, "74282", "150000", "2026-11-18T11:18:32.000Z"),
    ],
  },
  modelCovered: true,
  funding: "coding_plan",
  fundingCheck: "available",
  billingMode: "shared",
  taskCheck: "ready",
};

// Verbatim GET /wallet/balance answer.
const SAMPLE_WALLET = {
  balanceUsd: "1.1000",
  expiresAt: "2026-11-14T11:11:53.424Z",
  updatedAt: "2026-11-11T11:18:41.592Z",
  billingScopeVersion: 2,
  workspaceId: WS,
  workspaceMemberId: "eo67bhvpdut20r60qivuffrq",
};

const PS = { opendesignControlKey: CONTROL_KEY };

// The handler makes up to three calls: workspace discovery, then preflight +
// wallet in parallel. Queue them by URL so the parallel pair is order-independent.
// `workspaceId` moves the two read URLs when a test exercises a second workspace.
function mockRoutes({ workspaces = SAMPLE_WORKSPACES, preflight = SAMPLE_PREFLIGHT, wallet = SAMPLE_WALLET, workspaceId = WS } = {}) {
  const preflightUrl = `${API_BASE}/workspaces/${workspaceId}/billing/preflight`;
  const balanceUrl = `${API_BASE}/workspaces/${workspaceId}/wallet/balance`;
  proxyAwareFetch.mockImplementation(async (url) => {
    if (url === WORKSPACES_URL) {
      return workspaces instanceof Response ? workspaces : jsonResponse(workspaces);
    }
    if (url === preflightUrl) {
      if (preflight instanceof Error) throw preflight;
      return preflight instanceof Response ? preflight : jsonResponse(preflight);
    }
    if (url === balanceUrl) {
      if (wallet instanceof Error) throw wallet;
      return wallet instanceof Response ? wallet : jsonResponse(wallet);
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

const callUsage = (overrides = {}) => getUsageForProvider({
  provider: "opendesign-go",
  apiKey: "sk-amr-runtime-key",
  providerSpecificData: PS,
  ...overrides,
});

describe("opendesign-go registry usage flags", () => {
  it("opts into the apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opendesign-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opendesign-go");
  });

  it("publishes the control-plane usage url without losing transport settings", () => {
    expect(PROVIDERS["opendesign-go"].usage).toEqual({ url: WORKSPACES_URL });
    expect(PROVIDERS["opendesign-go"].baseUrl).toBe("https://amr-link.open-design.ai/v1/chat/completions");
    expect(PROVIDERS["opendesign-go"].timeoutMs).toBe(180000);
    expect(PROVIDERS["opendesign-go"].retry).toEqual({ 502: { attempts: 1, delayMs: 2000 } });
  });
});

describe("getUsageForProvider(opendesign-go)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the 5h window, the 7d window and the wallet balance", async () => {
    mockRoutes();

    const usage = await callUsage();

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("OpenDesign Go");
    expect(Object.keys(usage.quotas)).toEqual(["5 giờ", "7 ngày", "Balance ($)"]);

    // 32210 / 50000 = 64.42% used → 35.58% left.
    expect(usage.quotas["5 giờ"]).toEqual({
      used: 32210,
      total: 50000,
      remainingPercentage: 35.58,
      resetAt: "2026-11-12T02:18:32.000Z",
      unlimited: false,
    });
    // 74282 / 150000 = 49.5213…% used → 50.48% left.
    expect(usage.quotas["7 ngày"]).toEqual({
      used: 74282,
      total: 150000,
      remainingPercentage: 50.48,
      resetAt: "2026-11-18T11:18:32.000Z",
      unlimited: false,
    });
    expect(usage.quotas["Balance ($)"]).toEqual({
      used: 0,
      total: 1.1,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
      unit: "USD",
    });
  });

  it("sends the control key and the workspace header, never the runtime key", async () => {
    mockRoutes();

    await callUsage();

    const discovery = proxyAwareFetch.mock.calls.find(([url]) => url === WORKSPACES_URL);
    expect(discovery[1].headers.Authorization).toBe(`Bearer ${CONTROL_KEY}`);
    expect(discovery[1].headers["x-vela-workspace-id"]).toBeUndefined();

    const preflight = proxyAwareFetch.mock.calls.find(([url]) => url === PREFLIGHT_URL);
    expect(preflight[1].headers["x-vela-workspace-id"]).toBe(WS);
    expect(preflight[1].headers.accept).toBe("application/json");
    // apiKey (sk-amr) must never leak into the control-plane calls.
    expect(JSON.stringify(proxyAwareFetch.mock.calls)).not.toContain("sk-amr-runtime-key");
    expect(preflight[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps big credit strings exact instead of float-rounding them", async () => {
    // BigInt parsing is proven by the values themselves: Number("9007199254740993")
    // collapses to ...992, so a string→Number pipeline would report a *full* pool
    // for used = limit - 1. Everything below is past Number.MAX_SAFE_INTEGER.
    expect(Number("9007199254740993")).toBe(9007199254740992);
    expect(BigInt("9007199254740993")).toBe(9007199254740993n);

    mockRoutes({
      preflight: {
        workspaceId: WS,
        codingPlan: {
          eligible: true,
          windows: [
            planWindow(18000, "4503599627370497", "9007199254740994", "2026-11-12T02:18:32.000Z"),
          ],
        },
      },
    });

    const usage = await callUsage();

    // Exactly half of the pool is spent → the bar must read 50.00.
    const row = usage.quotas["5 giờ"];
    expect(row.remainingPercentage).toBe(50);
    expect(row.used).not.toBe(row.total);

    // A pool one credit short of full. Two decimals is the display floor, so
    // ~1e-16% legitimately renders as 0% — the point is that it is a finite,
    // correctly-derived 0 (the ratio was subtracted in BigInt, never computed as
    // Number(used)/Number(limit) where both operands are the same double).
    vi.clearAllMocks();
    mockRoutes({
      preflight: {
        workspaceId: WS,
        codingPlan: {
          eligible: true,
          windows: [planWindow(604800, "9007199254740993", "9007199254740994", null)],
        },
      },
    });

    const big = await callUsage();
    expect(big.quotas["7 ngày"].remainingPercentage).toBe(0);
    expect(Number.isFinite(big.quotas["7 ngày"].remainingPercentage)).toBe(true);
    // Narrowed for display only; the true value is still past the safe range.
    expect(big.quotas["7 ngày"].used).toBe(9007199254740992);
    // resetsAt null is accepted and surfaces as the null placeholder.
    expect(big.quotas["7 ngày"].resetAt).toBeNull();
  });

  it("asks for the Control Key when it is missing and never touches the network", async () => {
    const usage = await getUsageForProvider({
      provider: "opendesign-go",
      apiKey: "sk-amr-runtime-key",
      providerSpecificData: {},
    });

    expect(usage.message).toMatch(/chưa cấu hình Control Key/i);
    expect(usage.message).toMatch(/vela_ctrl/);
    expect(usage.message).toMatch(/sk-amr/);
    expect(usage.quotas).toBeUndefined();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("keeps the 5h/7d rows when the wallet read fails", async () => {
    mockRoutes({ wallet: jsonResponse({ error: "wallet down" }, 500) });

    const usage = await callUsage();

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["5 giờ"].used).toBe(32210);
    expect(usage.quotas["7 ngày"].used).toBe(74282);
    expect(usage.quotas["Balance ($)"]).toBeUndefined();
  });

  it("keeps the balance row when preflight fails", async () => {
    mockRoutes({ preflight: new Error("preflight timeout") });

    const usage = await callUsage();

    expect(usage.message).toBeUndefined();
    expect(Object.keys(usage.quotas)).toEqual(["Balance ($)"]);
    expect(usage.quotas["Balance ($)"].total).toBe(1.1);
  });

  it("returns a message only when both reads fail", async () => {
    mockRoutes({
      preflight: jsonResponse({ error: "boom" }, 500),
      wallet: new Error("ECONNRESET"),
    });

    const usage = await callUsage();

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/Không đọc được quota OpenDesign Go/i);
    expect(usage.message).toMatch(/preflight/);
    expect(usage.message).toMatch(/wallet/);
  });

  it("rejects an answer carrying another workspaceId", async () => {
    mockRoutes({
      preflight: { ...SAMPLE_PREFLIGHT, workspaceId: "someone-else" },
      wallet: { ...SAMPLE_WALLET, workspaceId: "someone-else" },
    });

    const usage = await callUsage();

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/workspaceId không khớp/i);
  });

  it("drops only the mismatched side", async () => {
    mockRoutes({ preflight: { ...SAMPLE_PREFLIGHT, workspaceId: "someone-else" } });

    const usage = await callUsage();

    // Wallet still matches this workspace → balance row survives.
    expect(Object.keys(usage.quotas)).toEqual(["Balance ($)"]);
  });

  it("shows only the balance when the coding plan is ineligible", async () => {
    mockRoutes({
      preflight: {
        ...SAMPLE_PREFLIGHT,
        codingPlan: { workspaceId: WS, eligible: false, tier: "go", windows: [] },
      },
    });

    const usage = await callUsage();

    expect(usage.message).toBeUndefined();
    expect(Object.keys(usage.quotas)).toEqual(["Balance ($)"]);
  });

  it("explains an empty dashboard when neither source has a renderable row", async () => {
    mockRoutes({
      preflight: { ...SAMPLE_PREFLIGHT, codingPlan: { eligible: false, windows: [] } },
      wallet: { workspaceId: WS },
    });

    const usage = await callUsage();

    expect(usage.quotas).toEqual({});
    expect(usage.message).toMatch(/không báo quota nào/i);
  });

  it("returns a message (no throw) when the workspace list itself fails", async () => {
    mockRoutes({ workspaces: jsonResponse({ error: "unauthorized" }, 401) });

    const usage = await callUsage();

    expect(usage.message).toMatch(/Không lấy được workspace/i);
    expect(usage.message).toMatch(/401/);
    expect(usage.quotas).toBeUndefined();
  });

  // Live 2026-11-12: a second account's Control Key listed a personal workspace
  // AND another account's workspace, with the foreign one first. Taking items[0]
  // showed the wrong account's credits under that connection.
  it("refuses to guess when the key sees several workspaces", async () => {
    const otherWs = "qzpqi2ov15kn454cvdnp0965";
    const foreignFirst = { items: [{ workspaceId: otherWs }, { workspaceId: WS }] };
    mockRoutes({ workspaces: foreignFirst });

    const usage = await callUsage();

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/thấy 2 workspace/i);
    // Both ids are named so the user can pick one deliberately.
    expect(usage.message).toContain(otherWs);
    expect(usage.message).toContain(WS);
    // Nothing may be read from either workspace until the user chooses.
    const fetched = proxyAwareFetch.mock.calls.map(([url]) => url);
    expect(fetched.some((url) => url.includes("/billing/preflight"))).toBe(false);
    expect(fetched.some((url) => url.includes("/wallet/balance"))).toBe(false);
  });

  it("uses the pinned workspace id without asking the list", async () => {
    const otherWs = "qzpqi2ov15kn454cvdnp0965";
    const pinnedData = { ...PS, opendesignWorkspaceId: otherWs };
    mockRoutes({
      workspaces: { items: [{ workspaceId: otherWs }, { workspaceId: WS }] },
      preflight: { ...SAMPLE_PREFLIGHT, workspaceId: otherWs,
        codingPlan: { ...SAMPLE_PREFLIGHT.codingPlan, workspaceId: otherWs } },
      wallet: { ...SAMPLE_WALLET, workspaceId: otherWs },
      workspaceId: otherWs,
    });
    const usage = await callUsage({ providerSpecificData: pinnedData });

    expect(Object.keys(usage.quotas)).toEqual(["5 giờ", "7 ngày", "Balance ($)"]);
    const fetched = proxyAwareFetch.mock.calls.map(([url]) => url);
    expect(fetched.some((url) => url === WORKSPACES_URL)).toBe(false);
    expect(fetched.some((url) => url.includes(otherWs))).toBe(true);
  });
});

describe("parseQuotaData(opendesign-go)", () => {
  it("forwards remainingPercentage, unlimited and unit to the dashboard rows", async () => {
    vi.clearAllMocks();
    mockRoutes();

    const usage = await callUsage();
    const rows = parseQuotaData("opendesign-go", usage);

    expect(rows.map((r) => r.name)).toEqual(["5 giờ", "7 ngày", "Balance ($)"]);
    expect(rows[0]).toMatchObject({
      name: "5 giờ",
      used: 32210,
      total: 50000,
      remainingPercentage: 35.58,
      resetAt: "2026-11-12T02:18:32.000Z",
      unlimited: false,
    });
    expect(rows[1]).toMatchObject({ used: 74282, total: 150000, remainingPercentage: 50.48 });
    expect(rows[2]).toMatchObject({
      total: 1.1,
      remainingPercentage: 100,
      unit: "USD",
      unlimited: false,
    });
  });
});
