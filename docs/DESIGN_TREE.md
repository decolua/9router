# 9router 功能整合与重构设计树（Design Tree）

本文件记录了将 `workdaddy`（账户总积分显示）和 `workbuddy2api`（自动签到领积分）整合到 `9router`，并移除 `9Remote` 与 `9English` 外部链接的完整设计决策树与执行计划。

---

## 1. 核心决策总览

| 决策项 | 决策内容 | 理由 / 说明 |
|---|---|---|
| **项目定位** | 保持名称 `9router` | 原地改造，降低部署和迁移成本 |
| **整合策略** | 完全吸收 | 将功能直接吸收至 9router 代码库，统一维护 |
| **代码保护** | 分支备份保留原代码 | 已创建 `backup/pre-migration` 分支备份 |
| **执行节奏** | 分阶段实施 | 先删旧功能，再增积分汇总，最后加自动签到 |
| **技术栈整合** | JavaScript 原生重写 | workbuddy2api 原 Go 签到逻辑改写为 JS，保持 9router 技术栈统一（Next.js + Node.js ESM） |
| **账户体系** | 沿用 9router 现有体系 | 直接使用 9router 的 SQLite `providerConnections` 表管理 CodeBuddy CN 账户，不额外引入 auth 文件 |
| **账户范围** | 仅支持个人账户 | 满足当前业务场景，简化逻辑 |
| **积分查询机制** | 实时查询 | 沿用已有查询链路，打开/刷新时向腾讯上游获取实时额度 |

---

## 2. 分阶段方案与细节规范

### 阶段 1：去除 9Remote 与 9English 外链

- **9Remote 去除**：
  - 删除组件：`src/shared/components/NineRemoteButton.js`
  - 删除组件：`src/shared/components/NineRemotePromoModal.js`
  - 侧边栏清理：修改 `src/shared/components/Sidebar.js`，移除 9Remote 按钮及弹窗组件的引用与渲染
  - 组件导出清理：修改 `src/shared/components/index.js`，移除 `NineRemoteButton` 导出
  - 国际化清理：清理 `public/i18n/literals/*.json` 中与 9Remote 相关的翻译词条
- **9English 去除**：
  - 侧边栏清理：移除 `src/shared/components/Sidebar.js` 中指向 `https://9english.net/` 的外部链接 `<a>` 标签
  - **特别保留**：保留 `dashboard/translator` 页面及 `src/app/api/translator/` 翻译路由与逻辑，不影响翻译器本身功能

### 阶段 2：集成总积分与总剩余积分汇总显示

- **UI 位置**：
  - 位于 `/dashboard/quota`（即 `ProviderLimits` 组件）最顶部上方
- **顶部汇总行内容**：
  - 显示所有 active 的 CodeBuddy CN 账户跨账户合计：
    - **总剩余积分**（Total Remaining Credits）
    - **总积分**（Total Quota / Capacity）
    - **今日签到状态**（全部已签到 / 部分已签到 / 未签到）
    - **一键签到按钮**
- **底部详情**：
  - 保持现有 `ProviderLimits` 表格展示不变，展示各个账户下的具体积分包（Monthly/Weekly/Daily/Bonus Packs）额度与进度条
- **数据源与处理**：
  - 在前端或后端聚合 CodeBuddy CN 连接的配额响应数据，准确计算 Cycle 与 Capacity 维度的累计总额及累计剩余

### 阶段 3：集成自动签到与手动一键签到

- **触发机制**：
  - **双模式**：后端定时触发 + 前端一键手动触发
- **定时调度器**：
  - 复用现有 `quotaAutoPing` 调度体系或扩展其定时器能力，按每日 `09:00` 和 `21:00` 自动对所有 active 的 CodeBuddy CN 连接执行签到
- **手动签到接口**：
  - 后端接口：`POST /api/usage/[connectionId]/checkin`（支持批量或针对特定连接签到）
  - 上游端点：`POST https://copilot.tencent.com/v2/billing/meter/daily-checkin`
- **Token 刷新**：
  - 每次签到或调用上游 API 时，利用 9router 现有 token 校验与自动 refresh 机制，过期自动刷新并写回 SQLite
- **联动刷新**：
  - 手动一键签到完成后，前端自动重新触发积分查询，刷新顶部汇总行与底部详情
- **错误处理**：
  - 遵循 9router 统一 Toast 提示与日志规范

---

## 3. 涉及的核心文件清单

| 类别 | 涉及文件 | 变动说明 |
|---|---|---|
| **阶段 1 (清理)** | `src/shared/components/NineRemoteButton.js` | 删除 |
| | `src/shared/components/NineRemotePromoModal.js` | 删除 |
| | `src/shared/components/Sidebar.js` | 移除 9Remote 按钮/弹窗及 9English 外链 |
| | `src/shared/components/index.js` | 移除 NineRemoteButton 导出 |
| | `public/i18n/literals/*.json` | 移除 Get 9Remote 相关键值 |
| **阶段 2 (展示)** | `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js` | 新增顶部跨账户总积分汇总栏与统计计算 |
| | `open-sse/services/usage/codebuddy-cn.js` | 确保积分包准确提供总量与剩余量 |
| **阶段 3 (签到)** | `open-sse/services/usage/codebuddy-cn.js` | 新增 `dailyCheckin(connection, ...)` 逻辑 |
| | `src/app/api/usage/[connectionId]/checkin/route.js` | 新增签到 API 路由 |
| | `src/shared/services/quotaAutoPing.js` | 注入 09:00 / 21:00 每日定时签到任务 |
| | `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js` | 挂载一键签到按钮与签到状态指示器 |
