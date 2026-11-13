/**
 * OpenDesign Go usage — coding-plan credit windows plus the workspace wallet.
 *
 *   GET https://amr-api.open-design.ai/api/v1/workspaces              → workspace list
 *   GET https://amr-api.open-design.ai/api/v1/workspaces/{ws}/billing/preflight
 *   GET https://amr-api.open-design.ai/api/v1/workspaces/{ws}/wallet/balance
 *   Auth: Bearer <controlKey> + x-vela-workspace-id: <ws>
 *
 * WHY this is separate from the chat lane: OpenDesign ships two credential
 * kinds. The `sk-amr-...` runtime key is all the chat transport at
 * amr-link.open-design.ai ever needs, but it is scoped to inference only and
 * returns nothing about quota. Only the `vela_ctrl_...` control-plane key can
 * read amr-api, so the connection carries it in
 * `providerSpecificData.opendesignControlKey` — the `apiKey` field stays
 * exactly the runtime key the executors send to amr-link.
 *
 * WHY defensive everywhere: amr-api is the vendor's *internal* dashboard API.
 * It is not documented for third parties, its paths carry no version promise
 * beyond `v1`, and its numeric fields are strings. Every read below is
 * validated and any failure degrades to a message instead of throwing, so a
 * private API change can never break the chat path that shares this process.
 *
 * Live-probed 2026-11-12 with a real control key (HTTP 200):
 *   /api/v1/workspaces → { "items": [ { "workspaceId": "c9cvnjeqq8watiii2r7p3k6g", ... } ] }
 *   /billing/preflight → { "schemaVersion": 1, "workspaceId": "...", "balanceUsd": "1.1000",
 *                          "codingPlan": { "eligible": true, "tier": "go", "windows": [
 *                            { "durationSeconds": 18000,  "usedCredits": "32210",  "limitCredits": "50000",
 *                              "remainingCredits": "17790", "resetsAt": "..." },
 *                            { "durationSeconds": 604800, "usedCredits": "74282",  "limitCredits": "150000",
 *                              "remainingCredits": "75718", "resetsAt": "..." } ] },
 *                          "funding": "coding_plan", ... }
 *   /wallet/balance   → { "balanceUsd": "1.1000", "expiresAt": "...", "workspaceId": "..." }
 *
 * WHY BigInt: `usedCredits`/`limitCredits` are decimal *strings*, not numbers, and
 * the plan allows credit pools far past 2^53 — `Number("9007199254740993")`
 * silently rounds, which would render a wrong bar. Parse as BigInt, divide there,
 * and only narrow to Number after the ratio is already a small float.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";

const API_BASE = "https://amr-api.open-design.ai/api/v1";
const WORKSPACES_URL = `${API_BASE}/workspaces`;
const PLAN = "OpenDesign Go";
// Per-request ceiling: the dashboard polls this on the quota page, so it must
// never hang behind a slow control plane.
const REQUEST_TIMEOUT_MS = 10000;
// Window duration (seconds) → dashboard row name. Only these two windows are
// rendered; anything else the vendor adds stays hidden until someone names it.
const WINDOW_NAMES = [
  [18000, "5 giờ"],
  [604800, "7 ngày"],
];

const MISSING_CONTROL_KEY_MESSAGE =
  "OpenDesign Go: chưa cấu hình Control Key. Dán Control Key (vela_ctrl_...) vào Settings của provider OpenDesign; runtime key sk-amr không đọc được quota.";

function authHeaders(controlKey, workspaceId) {
  const headers = {
    Authorization: `Bearer ${controlKey.trim()}`,
    accept: "application/json",
  };
  // The workspace header is only meaningful once the id is known; the
  // workspace-list call that discovers it authenticates with the Bearer alone.
  if (workspaceId) headers["x-vela-workspace-id"] = workspaceId;
  return headers;
}

// One GET with the shared 10s deadline. Returns a small outcome object instead
// of throwing so each caller can decide whether a failure is fatal *for it*.
async function getJson(url, controlKey, workspaceId, proxyOptions) {
  try {
    const response = await proxyAwareFetch(
      url,
      {
        method: "GET",
        headers: authHeaders(controlKey, workspaceId),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
      proxyOptions,
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return { ok: false, status: response.status, error: "response was not JSON" };
    }
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error?.message || "request failed" };
  }
}

// Discover the workspace id for this control key.
//
// WHY this refuses to guess when the key sees several workspaces: a Control Key
// can be a team/whoami key that lists more than one workspace (probed
// 2026-11-12: one key returned a personal workspace and a team workspace, with
// the team one first). Picking `items[0]` would then render *another account's*
// spend under this connection — the exact failure this guard prevents. The
// connection can pin `opendesignWorkspaceId` to choose explicitly.
async function resolveWorkspaceId(controlKey, providerSpecificData, proxyOptions) {
  const pinned = providerSpecificData?.opendesignWorkspaceId;
  if (typeof pinned === "string" && pinned.trim()) {
    return { workspaceId: pinned.trim(), error: null };
  }

  const result = await getJson(WORKSPACES_URL, controlKey, null, proxyOptions);
  if (!result.ok) return { workspaceId: null, error: result.error };

  const items = Array.isArray(result.body?.items) ? result.body.items : [];
  const ids = items
    .map((item) => (item && typeof item === "object" && typeof item.workspaceId === "string"
      ? item.workspaceId.trim()
      : ""))
    .filter(Boolean);
  if (ids.length === 0) {
    return { workspaceId: null, error: "không tìm thấy workspace nào cho Control Key này" };
  }
  if (ids.length > 1) {
    return {
      workspaceId: null,
      error: `Control Key này thấy ${ids.length} workspace (${ids.join(", ")}). Chọn workspace của tài khoản trong Settings của provider (providerSpecificData.opendesignWorkspaceId) để không hiển thị nhầm quota của workspace khác.`,
    };
  }
  return { workspaceId: ids[0], error: null };
}

// WHY compare workspaceId on every answer: the endpoint accepts whatever id is
// in the header, and a stale/mismatched workspace would render another
// workspace's spend as this connection's own. Treating a mismatch as a failure
// is the conservative choice.
function workspaceMatches(body, workspaceId) {
  if (!body || typeof body !== "object") return false;
  if (typeof body.workspaceId !== "string") return false;
  return body.workspaceId.trim() === workspaceId;
}

// Exact decimal-string → BigInt. Returns null for anything that is not a plain
// non-negative integer string, so a "12.5" or "" never silently becomes 0.
function parseCredits(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

// Remainder percentage computed *before* narrowing to Number: `Number(used) /
// Number(limit)` would already have lost precision on huge pools, and so would
// the two-step "scale the used ratio then subtract from 100" — 1 credit out of a
// 2^53 pool is ~1e-16 of a percent, below what a double ratio keeps. Subtracting
// in BigInt first keeps the numerator exact, so `1 - remaining/limit` is
// decided entirely in integer arithmetic and only the final small ratio is a
// float.
function remainingPercentOf(used, limit) {
  if (limit <= 0n) return null;
  const usedClamped = used > limit ? limit : used;
  const remaining = limit - usedClamped;
  // Scale by 100,000,000 so the two decimals survive the division truncation.
  const ratio = Number((remaining * 1000000000n) / limit) / 10000000;
  return Math.max(0, Math.min(100, ratio));
}

/**
 * Preflight window → dashboard row. Skipped (null) when the numbers are absent
 * or the limit is zero — a "0 / 0" row is noise, not a quota.
 */
function windowQuota(window) {
  if (!window || typeof window !== "object") return null;
  const used = parseCredits(window.usedCredits);
  const limit = parseCredits(window.limitCredits);
  if (used === null || limit === null || limit <= 0n) return null;

  const remainingPercent = remainingPercentOf(used, limit);
  if (remainingPercent === null) return null;

  return {
    // Narrowed only once the ratio exists; the raw pool sizes can exceed
    // Number.MAX_SAFE_INTEGER but the dashboard formats these two anyway.
    used: Number(used),
    total: Number(limit),
    remainingPercentage: Math.round(remainingPercent * 100) / 100,
    resetAt: parseResetTime(window.resetsAt),
    unlimited: false,
  };
}

function planQuotas(preflight) {
  const codingPlan = preflight?.codingPlan;
  const windows = Array.isArray(codingPlan?.windows) ? codingPlan.windows : [];
  if (codingPlan?.eligible === false || windows.length === 0) return {};

  const quotas = {};
  for (const [durationSeconds, name] of WINDOW_NAMES) {
    const window = windows.find((w) => w && toFiniteNumber(w.durationSeconds, -1) === durationSeconds);
    const quota = windowQuota(window);
    if (quota) quotas[name] = quota;
  }
  return quotas;
}

/**
 * Wallet → "Balance ($)" row. Same inverted convention as the other balance
 * rows in this directory: the wallet is money still available, so `used` is 0
 * and the bar sits at 100% while the remaining amount is `total`.
 */
function balanceQuota(body) {
  const raw = body?.balanceUsd;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const dollars = toFiniteNumber(raw.trim(), null);
  if (dollars === null || dollars < 0) return null;

  return {
    used: 0,
    total: Math.round(dollars * 100) / 100,
    remainingPercentage: 100,
    resetAt: null,
    unlimited: false,
    unit: "USD",
  };
}

function describeFailure(label, error) {
  return `${label}: ${error}`;
}

/**
 * @param {object} ctx — USAGE_HANDLERS context: { provider, apiKey,
 *   providerSpecificData, proxyOptions }
 */
export async function getOpenDesignUsage(ctx = {}) {
  const providerSpecificData = ctx.providerSpecificData || {};
  const controlKey = providerSpecificData.opendesignControlKey;

  if (!controlKey || typeof controlKey !== "string" || !controlKey.trim()) {
    // Deliberately explicit: users almost always paste the sk-amr key here
    // because that is the key the provider form asks for.
    return { plan: PLAN, message: MISSING_CONTROL_KEY_MESSAGE };
  }

  try {
    const resolved = await resolveWorkspaceId(controlKey, providerSpecificData, ctx.proxyOptions);
    if (!resolved.workspaceId) {
      return {
        plan: PLAN,
        message: `Không lấy được workspace OpenDesign: ${resolved.error}. Kiểm tra Control Key (vela_ctrl_...) hoặc đặt workspaceId thủ công.`,
      };
    }

    const workspaceId = resolved.workspaceId;
    const preflightUrl = `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/billing/preflight`;
    const balanceUrl = `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/wallet/balance`;

    // Two independent reads on purpose: the wallet is a separate service from
    // the plan ledger, and one being down must not hide the other's numbers.
    const [preflight, balance] = await Promise.all([
      getJson(preflightUrl, controlKey, workspaceId, ctx.proxyOptions),
      getJson(balanceUrl, controlKey, workspaceId, ctx.proxyOptions),
    ]);

    const quotas = {};
    const errors = [];

    if (!preflight.ok) {
      errors.push(describeFailure("preflight", preflight.error));
    } else if (!workspaceMatches(preflight.body, workspaceId)) {
      errors.push("preflight: workspaceId không khớp");
    } else {
      Object.assign(quotas, planQuotas(preflight.body));
    }

    if (!balance.ok) {
      errors.push(describeFailure("wallet", balance.error));
    } else if (!workspaceMatches(balance.body, workspaceId)) {
      errors.push("wallet: workspaceId không khớp");
    } else {
      const quota = balanceQuota(balance.body);
      if (quota) quotas["Balance ($)"] = quota;
    }

    const rowCount = Object.keys(quotas).length;

    // Both sources failed (or both were rejected) → nothing truthful to show.
    if (rowCount === 0 && errors.length >= 2) {
      return {
        plan: PLAN,
        message: `Không đọc được quota OpenDesign Go — ${errors.join("; ")}`,
      };
    }

    if (rowCount === 0) {
      // One source answered but carried no renderable row (e.g. an ineligible
      // coding plan or a wallet with no balance string).
      const tail = errors.length ? ` (${errors.join("; ")})` : "";
      return {
        plan: PLAN,
        message: `OpenDesign Go đã kết nối nhưng tài khoản này không báo quota nào${tail}.`,
        quotas: {},
      };
    }

    return { plan: PLAN, quotas };
  } catch (error) {
    return { plan: PLAN, message: `OpenDesign error: ${error.message}` };
  }
}
