/**
 * 守护「面向用户的字符串必须是英文」。
 *
 * ## 为什么需要这条用例
 *
 * 运行时 i18n 是**按英文原文查表**的（`src/i18n/runtime.js`：`translationMap[英文]`
 * → 译文）。因此任何中文原文落到界面上都**永远不会被翻译**，会原样留在英文 UI 里。
 *
 * 实测第一版就踩了这个坑：仪表盘上出现「Last: 已签到 7」和整段中文提示
 * （见 docs/checkin-feature.md 的记录）。人工验收很容易漏掉这种混排。
 *
 * ## 规则
 *
 * - **代码里的字符串字面量**：必须英文（会进 HTTP 响应 / 状态文件 / 界面）。
 * - **注释**：允许中文（给维护者看，渲染不到）。
 * - **`logLine(...)` 的实参**：允许中文 —— 那些只写 `process.stdout`（docker logs），
 *   读者是运维。
 *
 * 扫描器在 `tests/helpers/check-user-facing-strings.mjs`（手写状态机而不是正则：
 * 正则分不清字符串里的 `//` 和真注释，会给出自信但错误的结果）。
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here));
const checker = join(here, "..", "helpers", "check-user-facing-strings.mjs");

const FILES = [
  "src/shared/services/checkinProviders.js",
  "src/shared/services/checkinScheduler.js",
  "src/app/api/checkin/route.js",
  "src/app/(dashboard)/dashboard/checkin/CheckinClient.js",
].map((f) => join(repoRoot, f));

test("签到的面向用户字符串全部是英文（中文只允许在注释与 logLine 里）", () => {
  let out = "";
  let ok = true;
  try {
    out = execFileSync(process.execPath, [checker, ...FILES], { encoding: "utf8" });
  } catch (e) {
    ok = false;
    out = (e.stdout || "") + (e.stderr || "");
  }
  assert.equal(
    ok,
    true,
    `发现面向用户的中文字符串（i18n 只翻英文原文）:\n${out}`
  );
});

test("describeOutcome 永不返回中文（上游回声必须走 detail，不能进展示文案）", async () => {
  const { describeOutcome } = await import("../../src/shared/services/checkinProviders.js");
  const CJK = /[\u4e00-\u9fff]/;
  // 上游回中文 msg 是最容易把中文带进界面的路径（codebuddy/minimax 都这么做）。
  const cases = [
    { kind: "claimed", credit: 100, message: "今天已签到" },
    { kind: "already-claimed", message: "今天已签到，请明天再来" },
    { kind: "inactive", message: "无资格" },
    { kind: "failed", code: 1, message: "领取失败" },
    { kind: "unknown-future-kind", message: "新情况" },
    null,
    {},
  ];
  for (const c of cases) {
    const text = describeOutcome(c);
    assert.equal(typeof text, "string");
    assert.doesNotMatch(text, CJK, `describeOutcome(${JSON.stringify(c)}) 含中文: ${text}`);
  }
});
