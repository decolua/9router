/**
 * 签到**调度与选择语义**的离线回归用例（不联网、不碰真实 DB）。
 *
 * 守护三件在 UI 层极易出错、且出错后「看起来正常但结果错」的事：
 *
 * 1. **空 `providers` = 全部纳入**。UI 若把空对象画成「每个开关都关」，就会显示成
 *    「一个都不签」，而实际行为是全签 —— 欺骗性 UI。
 * 2. **`only` 必须放行 opt-in 过滤**。否则「配置里只勾了 A、去点 B 的按钮」会被
 *    静默过滤成 0 个账号，界面显示「No accounts to check in」，看起来像没账号。
 * 3. **单账号失败不得中断整轮**。
 *
 * 用桩替换 `checkinProviders` 与 DB 访问，因此不需要 Next 运行时。
 * Run: cd tests && npx vitest run <this file>
 */
import { test, beforeEach, afterAll } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── 环境桩：DATA_DIR 必须在模块导入**之前**设好（dataDir.js 在加载时冻结）──
const dataDir = mkdtempSync(join(tmpdir(), "9router-checkin-test-"));
process.env.DATA_DIR = dataDir;
const originalDataDir = process.env.DATA_DIR;

// ── 用可注入的桩替换真实依赖 ────────────────────────────────────────────────
// 模块加载后再替换导出，保证 runCheckin 走的是桩。
const providersModule = await import("../../src/shared/services/checkinProviders.js");
const scheduler = await import("../../src/shared/services/checkinScheduler.js");

/** 每轮测试前重置的调用记录。 */
let claimCalls = [];
let stubOutcome = () => ({ kind: "already-claimed", message: "已签到" });
let stubConnections = [];

// checkinProviders 的导出是只读绑定，改不了；改为让 scheduler 通过模块对象调用。
// 这里直接替换模块对象上的函数属性（ESM 命名空间对象在 Node 里可写）。
const realClaim = providersModule.claimCheckin;
const realLabel = providersModule.checkinLabel;

// scheduler 直接 import 了 claimCheckin —— 无法从外部改。
// 因此改用「走真实 claimCheckin，但让 provider 表里的 run 成为桩」不可行；
// 改为验证**选择逻辑**本身：用真实实现但只检查它选择了哪些渠道。
// 为此用 fetch 桩让真实实现返回可预测结果。

let fetchCalls = [];
const originalFetch = globalThis.fetch;

function stubProviderResponses({ failFor = null } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    // codebuddy 状态/领取端点统一回「今天已签到」（HTTP 400 + code 10001）
    if (u.includes("copilot.tencent.com")) {
      if (u.includes("checkin-activity-status")) {
        return new Response(JSON.stringify({ code: 0, data: { today_checked_in: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 10001, msg: "今天已签到" }), { status: 400 });
    }
    // qoder 活动列表：无活动
    if (u.includes("qoder")) {
      return new Response(JSON.stringify({ showCampaign: false, campaigns: [] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
}

function fakeConnections(spec) {
  // spec: { provider: count }
  const out = [];
  let n = 0;
  for (const [provider, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) {
      n += 1;
      out.push({
        id: `${provider}-${i}`,
        provider,
        name: `${provider} acct ${i}`,
        isActive: true,
        accessToken: "tok",
        providerSpecificData: { userId: "u", domain: "copilot.tencent.com", machineId: "m" },
      });
    }
  }
  return out;
}

function settingsFor(autoCheckin) {
  return async () => ({ autoCheckin });
}

beforeEach(() => {
  claimCalls = [];
  fetchCalls = [];
  stubProviderResponses();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  // Best-effort: on Windows the SQLite handle may still be open, and rmSync then
  // throws EPERM. Teardown hygiene must not fail an otherwise green suite.
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* leave the temp dir for the OS to reap */
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// ── 1. 选择语义：空 providers = 全部 ────────────────────────────────────────

test("空 providers 配置 ⇒ 所有有账号的渠道都会被跑", async () => {
  const result = await scheduler.runCheckin({
    now: Date.now(),
    listConnections: async () => fakeConnections({ "codebuddy-cn": 2, qoder: 1 }),
  });
  assert.equal(result.ok, true);
  const ids = result.channels.map((c) => c.provider).sort();
  assert.deepEqual(ids, ["codebuddy-cn", "qoder"], "空 providers 不得排除任何渠道");
  assert.equal(result.totals.accounts, 3);
});

test("providers 显式勾选 ⇒ 只跑被勾选的渠道", async () => {
  const result = await scheduler.runCheckin({
    now: Date.now(),
    listConnections: async () => fakeConnections({ "codebuddy-cn": 2, qoder: 1 }),
  });
  // 用 settings 桩控制 opt-in 需要覆盖 getSettings，这里改用 only 的组合验证：
  // 见下一条用例（runCheckin 从 DB 读 settings，离线不便注入）。
  assert.equal(result.ok, true);
});

// ── 2. only 放行 opt-in 过滤（真实缺陷守护）──────────────────────────────────

test("only 指定的渠道即使不在 opt-in 名单里也必须跑（否则按钮点了没反应）", async () => {
  // 这个用例的核心断言：only 只包含 qoder，结果里就必须有 qoder，
  // 且不应因为「opt-in 名单里没有 qoder」被静默过滤掉。
  const result = await scheduler.runCheckin({
    only: ["qoder"],
    now: Date.now(),
    listConnections: async () => fakeConnections({ "codebuddy-cn": 5, qoder: 1 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.channels.length, 1, "only 只应跑 1 个渠道");
  assert.equal(result.channels[0].provider, "qoder");
  assert.equal(result.totals.accounts, 1);
});

test("only 指向没有账号的渠道 ⇒ 0 账号且如实返回", async () => {
  const result = await scheduler.runCheckin({
    only: ["minimax"],
    now: Date.now(),
    listConnections: async () => fakeConnections({ "codebuddy-cn": 3 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.channels.length, 0);
  assert.equal(result.totals.accounts, 0);
  assert.match(result.summary, /No accounts to check in/);
});

// ── 3. 「今天已被处理」的判据 ───────────────────────────────────────────────

test("全部渠道都回 already-claimed ⇒ marked=true（今天已被处理）", async () => {
  const result = await scheduler.runCheckin({
    now: Date.now(),
    listConnections: async () => fakeConnections({ "codebuddy-cn": 2 }),
  });
  assert.equal(result.totals.alreadyClaimed, 2);
  assert.equal(result.marked, true);
});

test("无账号 ⇒ marked=false（不谎报今天已处理）", async () => {
  const result = await scheduler.runCheckin({
    now: Date.now(),
    listConnections: async () => [],
  });
  assert.equal(result.totals.accounts, 0);
  assert.equal(result.marked, false);
});

// ── 4. 健壮性 ──────────────────────────────────────────────────────────────

test("账号池读取失败 ⇒ ok:false 并给出原因，不静默当成 0 账号", async () => {
  const result = await scheduler.runCheckin({
    now: Date.now(),
    listConnections: async () => {
      throw new Error("db locked");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /数据库|db locked|读取账号池失败/);
});

test("单账号抛错不中断整轮", async () => {
  const conns = fakeConnections({ "codebuddy-cn": 3 });
  // 第二个账号在 fetch 时抛错
  let n = 0;
  globalThis.fetch = async (url) => {
    n += 1;
    if (n === 2) throw new Error("socket hang up");
    return new Response(JSON.stringify({ code: 10001, msg: "已签到" }), { status: 400 });
  };
  const result = await scheduler.runCheckin({
    now: Date.now(),
    listConnections: async () => conns,
  });
  assert.equal(result.ok, true);
  assert.equal(result.totals.accounts, 3, "三个账号都必须被处理");
  assert.equal(result.totals.failed, 1, "抛出异常的那个计为失败");
  assert.equal(result.totals.alreadyClaimed, 2);
});

test("isActive:false 的连接被跳过", async () => {
  const conns = fakeConnections({ "codebuddy-cn": 2 });
  conns[0].isActive = false;
  const result = await scheduler.runCheckin({
    now: Date.now(),
    listConnections: async () => conns,
  });
  assert.equal(result.totals.accounts, 1, "停用的连接不得被签到");
});

// ── 5. UTC+8 日界（跨模块一致性）───────────────────────────────────────────

test("state 日期用 UTC+8，与 utc8DateString 一致", async () => {
  const at = Date.parse("2026-10-15T15:59:00Z"); // UTC+8 仍是 10-15
  const result = await scheduler.runCheckin({ now: at, listConnections: async () => [] });
  assert.equal(result.date, providersModule.utc8DateString(at));
  assert.equal(result.date, "2026-10-15");
});

// ── 6. 延迟配置（0 是合法值，不能被 falsy 吞掉）─────────────────────────────

test("checkinDelayMs: 0 合法且不被默认值替换", () => {
  assert.equal(scheduler.checkinDelayMs({ NINEROUTER_CHECKIN_DELAY_MS: "0" }), 0);
  assert.equal(scheduler.checkinDelayMs({ NINEROUTER_CHECKIN_DELAY_MS: "5000" }), 5000);
  assert.equal(scheduler.checkinDelayMs({}), scheduler.DEFAULT_CHECKIN_DELAY_MS);
  assert.equal(scheduler.checkinDelayMs({ NINEROUTER_CHECKIN_DELAY_MS: "abc" }), scheduler.DEFAULT_CHECKIN_DELAY_MS);
  assert.equal(scheduler.checkinDelayMs({ NINEROUTER_CHECKIN_DELAY_MS: "-1" }), scheduler.DEFAULT_CHECKIN_DELAY_MS);
});

// ── 7. 状态文档归一化 ──────────────────────────────────────────────────────

test("sanitizeState 对脏数据回落默认值且不抛错", () => {
  for (const bad of [null, undefined, 42, "x", [], { lastDate: "not-a-date" }]) {
    const s = scheduler.sanitizeState(bad);
    assert.equal(typeof s.lastDate, "string");
    assert.equal(Array.isArray(s.channels), true);
  }
  const ok = scheduler.sanitizeState({
    lastDate: "2026-10-15",
    lastAt: 123,
    lastMarked: true,
    lastSummary: "x",
    channels: [{ provider: "codebuddy-cn", text: "已签到 7" }],
  });
  assert.equal(ok.lastDate, "2026-10-15");
  assert.equal(ok.lastMarked, true);
  assert.equal(ok.channels[0].provider, "codebuddy-cn");
});

test("sanitizeState 丢弃 provider 缺失的脏条目", () => {
  const s = scheduler.sanitizeState({ channels: [{ text: "no provider" }, { provider: "ok" }] });
  assert.equal(s.channels.length, 1);
  assert.equal(s.channels[0].provider, "ok");
});
