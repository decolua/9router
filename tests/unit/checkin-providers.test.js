/**
 * 签到协议层的**离线回归用例**（不联网）。
 *
 * 重点守护三类「静默错误」—— 它们的共同特征是**不报错但结果错**，
 * 因此在人工验收里极难发现，必须由用例兜住：
 *
 * 1. **凭据失效被误报成「今天没签」**（实测 minimax 精确命中）。
 * 2. **幂等分支被误报成「失败」**（codebuddy 重复领取是 HTTP 400，
 *    只看状态码就会把「今天已签」当失败，进而被重试甚至被当成凭据问题）。
 * 3. **UTC+8 日界算错**（偏东提前记「今天已跑」⇒ 真漏签；偏西一天跑两次）。
 *
 * Run: cd tests && npx vitest run <this file>
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import {
  utc8DateString,
  isCheckinSupported,
  unsupportedReason,
  checkinStatus,
  claimCheckin,
  describeOutcome,
  listCheckinProviders,
  resolveIanaTimezone,
} from "../../src/shared/services/checkinProviders.js";

// ── 用可注入的 fetch 替换全局，逐形状断言解析逻辑 ────────────────────────────

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CODEBUDDY_CREDS = {
  accessToken: "tok",
  providerSpecificData: { userId: "u1", domain: "copilot.tencent.com" },
};

// ── 1. UTC+8 日界 ──────────────────────────────────────────────────────────

test("utc8DateString: 16:00Z 之后进入次日（UTC+8 日界）", () => {
  assert.equal(utc8DateString(Date.parse("2026-10-15T15:59:59Z")), "2026-10-15");
  assert.equal(utc8DateString(Date.parse("2026-10-15T16:00:00Z")), "2026-10-16");
  assert.equal(utc8DateString(Date.parse("2026-10-15T23:30:00Z")), "2026-10-16");
});

test("utc8DateString: 与进程时区无关", () => {
  // 同一时刻在不同 TZ 环境下必须得到同一结果（用算术平移而不是本地时区）。
  const t = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(utc8DateString(t), "2026-01-01");
});

// ── 2. 不支持的渠道必须零请求 ───────────────────────────────────────────────

test("cline/workbuddy/raccoon/gemini 无实现且给出原因", () => {
  for (const p of ["cline", "workbuddy", "raccoon", "gemini"]) {
    assert.equal(isCheckinSupported(p), false, `${p} 不应有实现`);
  }
  // 这些原因是**直接渲染到界面**的，因此必须是英文（i18n 只翻英文原文）。
  assert.match(unsupportedReason("cline"), /does not support daily check-in/);
  assert.match(unsupportedReason("workbuddy"), /does not support daily check-in/);
  assert.match(unsupportedReason("raccoon"), /does not support daily check-in/);
});

test("claimCheckin(不支持的渠道) 不发任何网络请求", async () => {
  let called = 0;
  const restore = stubFetch(async () => { called++; return jsonResponse({}); });
  try {
    const outcome = await claimCheckin("cline", {});
    assert.equal(outcome.kind, "failed");
    assert.equal(called, 0, "不得发出上游请求");
  } finally {
    restore();
  }
});

// ── 3. 凭据失效 ≠ 今天没签 ──────────────────────────────────────────────────

test("HTTP 401 必须报凭据失效，不能报「未签到」", async () => {
  const restore = stubFetch(async () =>
    jsonResponse({ error: "invalid access token" }, 401),
  );
  try {
    // minimax 的形状：401 + JSON body（能被解析，所以尤其容易被误判成成功）。
    const st = await checkinStatus("minimax", { apiKey: "dead", accessToken: "dead" });
    assert.equal(st.ok, false, "401 必须判为失败");
    assert.match(st.message, /Credential expired/);

    const cl = await claimCheckin("minimax", { apiKey: "dead", accessToken: "dead" });
    assert.equal(cl.kind, "failed");
    assert.match(cl.message, /Credential expired/);

    // qoder 同型
    const qd = await checkinStatus("qoder", { accessToken: "dead" });
    assert.equal(qd.ok, false);
    assert.match(qd.message, /Credential expired/);

    // codebuddy 同型
    const cb = await checkinStatus("codebuddy-cn", CODEBUDDY_CREDS);
    assert.equal(cb.ok, false);
    assert.match(cb.message, /Credential expired/);
  } finally {
    restore();
  }
});

// ── 4. 幂等分支：判据在响应体，不在 HTTP 状态码 ──────────────────────────────

test("codebuddy 重复领取（HTTP 400 + code 10001）判定为「今天已签」而非失败", async () => {
  const restore = stubFetch(async () =>
    jsonResponse({ code: 10001, msg: "今天已签到，请明天再来" }, 400),
  );
  try {
    const outcome = await claimCheckin("codebuddy-cn", CODEBUDDY_CREDS);
    assert.equal(outcome.kind, "already-claimed");
    // 展示文案必须是英文（i18n 只翻英文原文）...
    assert.match(describeOutcome(outcome), /already checked in/i);
    assert.doesNotMatch(describeOutcome(outcome), /[\u4e00-\u9fff]/, "展示文案不得含中文");
    // ...而上游原文仍要保留，便于对照排查。
    assert.equal(outcome.detail, "今天已签到，请明天再来");
  } finally {
    restore();
  }
});

test("codebuddy 备用码 1001 同样判定为已签", async () => {
  const restore = stubFetch(async () => jsonResponse({ code: 1001, msg: "已领取" }, 400));
  try {
    const outcome = await claimCheckin("codebuddy-cn", CODEBUDDY_CREDS);
    assert.equal(outcome.kind, "already-claimed");
  } finally {
    restore();
  }
});

test("codebuddy 真正领取成功返回 claimed + credit", async () => {
  const restore = stubFetch(async () =>
    jsonResponse({ code: 0, msg: "OK", data: { credit: 100, streak_days: 5 } }),
  );
  try {
    const outcome = await claimCheckin("codebuddy-cn", CODEBUDDY_CREDS);
    assert.equal(outcome.kind, "claimed");
    assert.equal(outcome.credit, 100);
    assert.equal(outcome.streakDays, 5);
  } finally {
    restore();
  }
});

test("codebuddy 无资格/活动结束判定为 inactive（不是 already-claimed）", async () => {
  for (const code of [1002, 1003]) {
    const restore = stubFetch(async () => jsonResponse({ code, msg: "无资格" }, 400));
    try {
      const outcome = await claimCheckin("codebuddy-cn", CODEBUDDY_CREDS);
      assert.equal(outcome.kind, "inactive", `code ${code} 应为 inactive`);
    } finally {
      restore();
    }
  }
});

test("codebuddy 网关返回 HTML 错误页时给出可读原因，不含 'Unexpected token'", async () => {
  const restore = stubFetch(async () =>
    new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 }),
  );
  try {
    const outcome = await claimCheckin("codebuddy-cn", CODEBUDDY_CREDS);
    assert.equal(outcome.kind, "failed");
    assert.doesNotMatch(outcome.message, /Unexpected token/);
    assert.match(outcome.message, /502/);
  } finally {
    restore();
  }
});

// ── 5. Qoder：replayed 幂等 + 「无活动」≠「已领」 ────────────────────────────

function qoderFetch({ campaigns, replayed = false }) {
  return async (url) => {
    if (String(url).includes("/claim")) {
      return jsonResponse(replayed ? { replayed: true } : { data: { benefit: { amount: 100 } } });
    }
    return jsonResponse({ showCampaign: true, claimable: true, campaigns });
  };
}

test("qoder replayed:true 判定为已领（重复领取同样是 200）", async () => {
  const restore = stubFetch(
    qoderFetch({
      replayed: true,
      campaigns: [
        { campaignId: "c1", actionType: "CLAIM_BENEFIT", claimStatus: "CLAIMABLE", benefit: { amount: 100 } },
      ],
    }),
  );
  try {
    const outcome = await claimCheckin("qoder", { accessToken: "t" });
    assert.equal(outcome.kind, "already-claimed");
  } finally {
    restore();
  }
});

test("qoder 无可领活动且未领过 ⇒ inactive（绝不能报已领）", async () => {
  const restore = stubFetch(
    qoderFetch({ campaigns: [{ campaignId: "c1", actionType: "VIEW_DETAILS", claimStatus: "CLAIMABLE" }] }),
  );
  try {
    const outcome = await claimCheckin("qoder", { accessToken: "t" });
    assert.equal(outcome.kind, "inactive", "无可领项不得报 already-claimed —— 那会让当天真漏领");
  } finally {
    restore();
  }
});

test("qoder 存在 CLAIMED 的领分类活动 ⇒ 判定今日已领", async () => {
  const restore = stubFetch(
    qoderFetch({
      campaigns: [
        { campaignId: "c1", actionType: "CLAIM_BENEFIT", claimStatus: "CLAIMED", benefit: { amount: 100 } },
      ],
    }),
  );
  try {
    const st = await checkinStatus("qoder", { accessToken: "t" });
    assert.equal(st.ok, true);
    assert.equal(st.todayCheckedIn, true, "CLAIM_BENEFIT+CLAIMED 是「已领」的可靠判据");
  } finally {
    restore();
  }
});

test("qoder 只有 VIEW_DETAILS 时 todayCheckedIn 为 false（活动没刷新≠已领）", async () => {
  const restore = stubFetch(
    qoderFetch({ campaigns: [{ campaignId: "c1", actionType: "VIEW_DETAILS", claimStatus: "CLAIMABLE" }] }),
  );
  try {
    const st = await checkinStatus("qoder", { accessToken: "t" });
    assert.equal(st.ok, true);
    assert.equal(st.todayCheckedIn, false);
  } finally {
    restore();
  }
});

test("qoder 领取成功带出 benefit.amount", async () => {
  const restore = stubFetch(
    qoderFetch({
      campaigns: [
        { campaignId: "c1", actionType: "CLAIM_BENEFIT", claimStatus: "CLAIMABLE", benefit: { amount: 100 } },
      ],
    }),
  );
  try {
    const outcome = await claimCheckin("qoder", { accessToken: "t" });
    assert.equal(outcome.kind, "claimed");
    assert.equal(outcome.credit, 100);
  } finally {
    restore();
  }
});

// ── 6. MiniMax：claim_result 幂等 + 业务码 ──────────────────────────────────

test("minimax claim_result:2 判定为已签", async () => {
  const restore = stubFetch(async () => jsonResponse({ data: { claim_result: 2 } }));
  try {
    const outcome = await claimCheckin("minimax", { accessToken: "t" });
    assert.equal(outcome.kind, "already-claimed");
  } finally {
    restore();
  }
});

test("minimax claim_result:1 判定为成功并读出 points", async () => {
  const restore = stubFetch(async () => jsonResponse({ data: { claim_result: 1, points: 800 } }));
  try {
    const outcome = await claimCheckin("minimax", { accessToken: "t" });
    assert.equal(outcome.kind, "claimed");
    assert.equal(outcome.credit, 800);
  } finally {
    restore();
  }
});

test("minimax base_resp.status_code 非 0 ⇒ 失败（HTTP 200 也算失败）", async () => {
  const restore = stubFetch(async () =>
    jsonResponse({ base_resp: { status_code: 1004, status_msg: "invalid timezone_id" } }),
  );
  try {
    const outcome = await claimCheckin("minimax", { accessToken: "t" });
    assert.equal(outcome.kind, "failed", "业务码非 0 必须是失败，尽管 HTTP 是 200");
    assert.equal(outcome.code, 1004);
    // 展示文案是英文兜底；上游原文留在 detail（i18n 只翻英文原文）。
    assert.match(outcome.message, /Upstream error 1004/);
    assert.equal(outcome.detail, "invalid timezone_id");
  } finally {
    restore();
  }
});

test("minimax 缺失 claim_result ⇒ 失败，不编造成功", async () => {
  const restore = stubFetch(async () => jsonResponse({ data: {} }));
  try {
    const outcome = await claimCheckin("minimax", { accessToken: "t" });
    assert.equal(outcome.kind, "failed");
  } finally {
    restore();
  }
});

// ── 7. 请求头契约 ──────────────────────────────────────────────────────────

test("codebuddy 带齐 X-Domain / X-Product-Code / X-User-Id", async () => {
  let seen = null;
  const restore = stubFetch(async (url, init) => {
    seen = init.headers;
    return jsonResponse({ code: 0, data: { credit: 1 } });
  });
  try {
    await claimCheckin("codebuddy-cn", CODEBUDDY_CREDS);
    assert.equal(seen["X-Domain"], "copilot.tencent.com");
    assert.equal(seen["X-Product"], "SaaS");
    assert.equal(seen["X-Product-Code"], "codebuddy");
    assert.equal(seen["X-User-Id"], "u1");
    assert.equal(seen.Authorization, "Bearer tok");
  } finally {
    restore();
  }
});

test("qoder 用 Cosy-ClientType:10，缺 machineId 时不发空 machine 头", async () => {
  let seen = null;
  const restore = stubFetch(async (url, init) => {
    seen = init.headers;
    return jsonResponse({ campaigns: [] });
  });
  try {
    await checkinStatus("qoder", { accessToken: "t", providerSpecificData: {} });
    assert.equal(seen["Cosy-ClientType"], "10", "必须是 '10'（桌面 app），'5' 恒拿不到可领活动");
    assert.equal("Cosy-MachineToken" in seen, false, "缺 machineId 时不得发空头");
  } finally {
    restore();
  }
});

test("qoder 有 machineId 时成对发送 machine 头", async () => {
  let seen = null;
  const restore = stubFetch(async (url, init) => {
    seen = init.headers;
    return jsonResponse({ campaigns: [] });
  });
  try {
    await checkinStatus("qoder", { accessToken: "t", providerSpecificData: { machineId: "m-1" } });
    assert.equal(seen["Cosy-MachineToken"], "m-1");
    assert.equal(seen["Cosy-MachineType"], "5");
  } finally {
    restore();
  }
});

test("minimax 状态查询带 timezone_id（按客户端时区结算，不是 UTC+8）", async () => {
  let seenUrl = null;
  const restore = stubFetch(async (url) => {
    seenUrl = String(url);
    return jsonResponse({ data: { panel: { days: [] } } });
  });
  try {
    await checkinStatus("minimax", { accessToken: "t" }, { timezoneId: "Asia/Shanghai" });
    assert.match(seenUrl, /timezone_id=Asia%2FShanghai/);
  } finally {
    restore();
  }
});

// ── 8. 元数据 ──────────────────────────────────────────────────────────────

test("有实现的渠道清单含 5 项且都有 label", () => {
  const list = listCheckinProviders();
  assert.equal(list.length, 5);
  for (const p of list) {
    assert.ok(p.label && p.label.length > 0, `${p.id} 缺 label`);
  }
  // 未经真实账号实测的必须显式标出，不能假装已验证。
  assert.equal(list.find((p) => p.id === "codebuddy-intl").verified, false);
  assert.equal(list.find((p) => p.id === "codebuddy-cn").verified, true);
});

test("resolveIanaTimezone 在异常时回落 UTC 而不是抛错", () => {
  assert.equal(resolveIanaTimezone(() => { throw new Error("boom"); }), "UTC");
  assert.equal(resolveIanaTimezone(() => "  "), "UTC");
  assert.equal(resolveIanaTimezone(() => "Asia/Tokyo"), "Asia/Tokyo");
});
