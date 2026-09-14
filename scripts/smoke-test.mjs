#!/usr/bin/env node
// 冒烟测试：打测试实例（默认 http://localhost:20129，可用 SMOKE_BASE 覆盖）。
// 检查：dashboard 页面、统计 API 结构、网关鉴权。不打真实上游，不花钱。
// 用法: node scripts/smoke-test.mjs
const BASE = process.env.SMOKE_BASE || "http://localhost:20129";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failed++;
};

// 1. dashboard 页面可访问
const page = await fetch(`${BASE}/dashboard`).then((r) => r.status).catch(() => 0);
ok("dashboard page reachable", page === 200, `status=${page}`);

// 2. 登录拿 session（测试实例独立 DB，默认密码 123456，loopback 允许）
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: process.env.SMOKE_PASSWORD || "123456" }),
}).catch(() => null);
const cookie = loginRes?.headers.getSetCookie?.()?.[0]?.split(";")[0] || "";
ok("dashboard login works", !!cookie, loginRes ? `status=${loginRes.status}` : "no response");

// 3. 统计 API 结构完整（带 session cookie）
const stats = await fetch(`${BASE}/api/usage/statistics?pageSize=5`, {
  headers: cookie ? { Cookie: cookie } : {},
})
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
ok("statistics api responds", !!stats, stats ? "" : "no/invalid response");
if (stats && !stats.error) {
  for (const k of ["filters", "summary", "series", "items", "pagination"]) {
    ok(`statistics.${k} present`, k in stats);
  }
}

// 4. 网关存活：/v1/models 无 key 应 401（鉴权生效）或 200（配置了免鉴权/本地），5xx/超时即挂
const models = await fetch(`${BASE}/v1/models`).then((r) => r.status).catch(() => 0);
ok("gateway /v1/models alive", models === 401 || models === 200, `status=${models}`);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
