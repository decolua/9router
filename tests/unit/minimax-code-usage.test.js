// MiniMax Code usage (P2) — signed account API, membership/plan-window parsing,
// the usage handler's dashboard shape, and the suggested-models live filter.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  signedAccountRequest,
  parseMembership,
  parsePlanWindows,
  getMiniMaxCodeUsage,
} from "../../open-sse/services/minimaxCodeUsage.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("minimax-code signed account API", () => {
  it("builds deterministic GET signing with mcode query params", () => {
    const NOW = 1728200000000;
    const { url, init } = signedAccountRequest(
      { agent: "https://agent.minimaxi.com", lang: "zh" },
      "/matrix/api/v1/commerce/get_membership_info",
      { access: "tok", userID: "42", now: NOW, tzOffsetSec: 480 }
    );
    expect(init.method).toBe("GET");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://agent.minimaxi.com/matrix/api/v1/commerce/get_membership_info");
    expect(u.searchParams.get("device_platform")).toBe("mcode");
    expect(u.searchParams.get("app_id")).toBe("3001");
    expect(u.searchParams.get("user_id")).toBe("42");
    expect(u.searchParams.get("timezone_offset")).toBe("480");
    expect(init.headers["x-signature"]).toMatch(/^[0-9a-f]{32}$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("unknown user ids degrade to 0 instead of undefined", () => {
    const { url } = signedAccountRequest(
      { agent: "https://agent.minimaxi.com", lang: "zh" },
      "/v1/api/user/info",
      { access: "tok", userID: undefined }
    );
    expect(new URL(url).searchParams.get("user_id")).toBe("0");
  });
});

describe("minimax-code membership parsing", () => {
  it("reads plan tier, group id and credit balance", () => {
    const m = parseMembership({
      data: {
        has_token_plan: true,
        token_plan_tier: "pro",
        token_plan_expires_at: 1790000000,
        op_group_id: "g-1",
        op_credit_summary: { total_remaining_amount: "1234.5" },
      },
    });
    expect(m.hasTokenPlan).toBe(true);
    expect(m.tier).toBe("pro");
    expect(m.opGroupId).toBe("g-1");
    expect(m.balance).toBe("1234.5");
    expect(m.expiresAt).toBe(1790000000);
  });
});

describe("minimax-code plan window parsing", () => {
  const HOUR = 3600_000;
  it("maps interval + weekly rows to percent windows with resetsAt", () => {
    const now = Date.now();
    const rows = parsePlanWindows({
      model_remains: [
        {
          model_name: "general",
          current_interval_remaining_percent: 50,
          current_interval_status: 1,
          start_time: Math.floor(now / 1000),
          end_time: Math.floor(now / 1000) + 5 * 3600,
          current_weekly_remaining_percent: 80,
          current_weekly_status: 1,
          weekly_start_time: Math.floor(now / 1000),
          weekly_end_time: Math.floor(now / 1000) + 7 * 24 * 3600,
        },
      ],
    });
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.name);
    expect(names).toContain("5 hours");
    expect(names).toContain("7 days");
    for (const r of rows) {
      expect(r.total).toBe(100);
      expect(r.remaining).toBe(r.remainingPercentage);
      expect(new Date(r.resetAt).getTime()).toBeGreaterThan(now);
    }
    expect(rows.find((r) => r.name.includes("5 hours")).remaining).toBe(50);
    expect(rows.find((r) => r.name.includes("7 days")).remaining).toBe(80);
  });

  it("marks a depleted window (status 2) at 0% and skips claimed ones (status 3)", () => {
    const rows = parsePlanWindows({
      model_remains: [
        { model_name: "general", current_interval_status: 2, current_interval_remaining_percent: 0, current_weekly_status: 3 },
        { model_name: "minimax-m3.1", current_interval_status: 1, current_interval_remaining_percent: 25, current_weekly_status: 3 },
      ],
    });
    expect(rows.find((r) => r.name === "Allowance").remaining).toBe(0);
    expect(rows.find((r) => r.name.startsWith("Minimax-m3.1")).remaining).toBe(25);
  });
});

describe("minimax-code usage handler", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  it("returns a credits balance row plus plan windows", async () => {
    const HOUR = 3600_000;
    const now = Math.floor(Date.now() / 1000);
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("get_user_extra_info")) {
        return new Response(JSON.stringify({
          workspaces: [{
            workspace_type: 0, workspace_id: 7,
            has_token_plan: true, token_plan_tier: "pro", op_group_id: "g-1",
            op_credit_summary: { total_remaining_amount: "1234.5" },
          }],
        }), { status: 200 });
      }
      if (u.includes("get_membership_info")) {
        return new Response(JSON.stringify({ data: { has_token_plan: true, op_group_id: "g-1" } }), { status: 200 });
      }
      if (u.includes("coding_plan/remains")) {
        return new Response(JSON.stringify({
          model_remains: [{
            model_name: "general",
            current_interval_remaining_percent: 50,
            current_interval_status: 1,
            start_time: now,
            end_time: now + 5 * HOUR,
            current_weekly_status: 3,
          }],
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const out = await getMiniMaxCodeUsage({
      provider: "minimax-code",
      accessToken: "tok",
      providerSpecificData: { realUserID: "123" },
    });
    expect(out.plan).toBe("M Plan pro");
    expect(out.user).toBe("123");
    expect(out.quotas.Credits.isCreditBalance).toBe(true);
    expect(out.quotas.Credits.total).toBe(1234.5);
    const windowRows = Object.values(out.quotas).filter((q) => (q.name || "").includes("hours") || (q.name || "").includes("7 days"));
    expect(windowRows.length).toBe(1);
    expect(windowRows[0].remaining).toBe(50);
  });

  it("reports a refused sign-in as an auth-expired message (route retries once)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("denied", { status: 401 }));
    const out = await getMiniMaxCodeUsage({
      provider: "minimax-code",
      accessToken: "dead",
      providerSpecificData: { realUserID: "123" },
    });
    expect(out.message).toContain("unauthorized");
  });
});

describe("minimax-code suggested-models filter", () => {
  it("parses the mavis live catalog shape", () => {
    const rows = FILTERS["minimax-code"]([{
      providers: [{
        providerId: "minimax",
        config: {
          model_order: ["MiniMax-M3"],
          models: {
            "MiniMax-M3.1-Flash-Preview": { name: "M3.1 Flash", limit: { context: 512000, output: 128000 } },
            "MiniMax-M3": { name: "MiniMax M3", limit: { context: 512000, output: 128000 } },
            bad: null,
          },
        },
      }],
    }]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("MiniMax-M3.1-Flash-Preview"); // bigger context first
    expect(rows[0].contextLength).toBe(512000);
    expect(rows.map((r) => r.id)).toContain("MiniMax-M3");
  });

  it("returns nothing for a malformed payload", () => {
    expect(FILTERS["minimax-code"]([{ providers: [] }])).toEqual([]);
    expect(FILTERS["minimax-code"]([])).toEqual([]);
  });
});

describe("dashboard parseQuotaData minimax case", () => {
  it("passes balance and window rows through", () => {
    const rows = parseQuotaData("minimax-code", {
      quotas: {
        Credits: { used: 0, total: 1234.5, isCreditBalance: true, currency: "credits" },
        "General · 5 hours": { used: 50, total: 100, remaining: 50, remainingPercentage: 50, resetAt: "2026-10-06T20:00:00Z" },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].isCreditBalance).toBe(true);
    expect(rows[0].currency).toBe("credits");
    expect(rows[1].remaining).toBe(50);
  });
});
