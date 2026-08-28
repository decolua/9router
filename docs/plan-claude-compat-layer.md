# 方案：9router 原生 Claude 兼容层（替代 cc-switch）

> 状态：**核心层已实施（列表侧 + 请求侧 + 配置 + UI + 单测）**，日期：2026-08-24。
> 背景：cc-switch 在本地 127.0.0.1:15721 做了一层 claude- 前缀代理，让 Claude Code 能看到并选中非 Claude 模型。本方案把该逻辑原生做进 9router，使 Claude Code 可直连 `ANTHROPIC_BASE_URL=http://localhost:20128`，退役 cc-switch。

## 0. 实证基础（Claude Code v2.1.235 二进制逆向结论）

- **模型发现**：fetch `{base}/v1/models?limit=1000`，硬编码带 `anthropic-version: 2023-06-01` 头。
- **zod schema**：只解析 `{id, display_name?}`，其余字段（context_length 等）全部 strip —— 所以 `/v1/models` 返回的 context_length 对 Claude Code 无意义。
- **id 过滤**：`/(claude|anthropic)/i` 子串匹配——**不带前缀的模型根本不显示**，这就是前缀必要性的根源。
- **[1m] 后缀**：`/\[1m\]$/i` 大小写不敏感剥除；命中即触发请求头 `anthropic-beta: context-1m-2025-08-07`。**是协议层 beta 开关，不是展示信息** → 必要。
- **anthropic-version 头**：内嵌 @anthropic-ai/sdk defaultHeaders 硬编码，每个请求（/v1/messages、/v1/messages/count_tokens、/v1/models）必带；OpenAI 生态客户端必不带 → 作为触发信号判定完备。
- 二进制内 `contextLength` 是 agent transcript 数组长度，与模型窗口无关，勿混淆。

## 1. 已定决策

| 决策点 | 选定 | 理由 |
|---|---|---|
| 触发方式 | **自动检测**：请求带 `anthropic-version` 头 → 应用 claude- 改写 | Anthropic SDK 硬编码必带 / OpenAI 必不带，零配置、互斥完备 |
| 1M 策略 | **三态可配** `claudeCompat.suffixMode`: `off` / `auto`(默认) / `keywords` | 用户要求：管理端自行抉择，不硬编码 deepseek/glm 关键字 |

- `auto`：模型 context_length ≥ 1,000,000 才加 `[1m]` 后缀
- `keywords`：模型 id 匹配 `keywords[]` 任一子串才加
- `off`：永不加

## 2. 与 cc-switch 的差异（修复其 bug）

cc-switch (`src-tauri/src/proxy/handlers.rs:177-197`) 两个 bug：
1. **无条件剥 `claude-` 前缀** → 官方真 claude 模型被误伤（claude-sonnet-4-5 被剥成 sonnet-4-5）
2. **`[1M]` 大小写敏感** → 只认 `[1M]` 不认 `[1m]`，而 Claude Code 发回的是原样回传，恰好闭环但脆弱

本方案：
- 防误剥算法（见 §4）
- 后缀统一小写 `[1m]`（Claude Code 剥除正则本就大小写不敏感）

## 3. 改动清单（已实施）

> 实施落点与方案略有差异，以实际代码为准：
> - 核心逻辑集中在新文件 **`src/lib/claudeCompat.js`**（触发判定、归一化、列表改写、settings 解析）
> - 请求侧插在 **`src/sse/handlers/chat.js`**（`handleChat` 内、combo/account 选择前）而非两个 route 文件——一处覆盖 `/v1/messages` 与所有格式入口
> - `count_tokens` 路由不读 model 字段（纯字符估算），**无需改动**
> - 触发判定在请求侧用**模型名形状**（`claude-` 前缀或 `[1m]` 后缀）而非 anthropic-version 头——头检测留给无状态 GET；两者对 Claude Code 等价
> - `DISABLE_CLAUDE_COMPAT=true` 环境变量可整体关闭

### 文件 1：列表侧 `src/app/api/v1/models/route.js`（GET）

检测到 `anthropic-version` 请求头时改写输出：
- `id = "claude-" + 原id`
- `display_name` = 真实模型名（剥掉内部 `[1m]` 标记后用于展示）
- 按 suffixMode 决定是否追加 `[1m]` 后缀
- 无头 → 输出完全不变（OpenAI 视角零影响）

### 文件 2+3：请求侧（`src/sse/handlers/chat.js`）

归一化 `body.model` + `modelStr`，防误剥算法：

用量统计记**真实（映射后）模型名**。

实际防误剥算法（比方案更保守，修掉 cc-switch 的误伤类 bug）：
1. 剥 `[1m]` 后缀（`/\[1m\]$/i`）
2. 不带 `claude-` 前缀 → 返回剥后缀结果
3. `claude-{x}` 且 `{x}` 含 `/`（路由形式）→ 剥前缀用 `{x}`
4. `claude-{x}` 且 `{x}` 是已知 combo/别名 → 用 `{x}`
5. 其余（含官方 claude-sonnet-4-5 等未知名）→ **原样保留**
   > 方案原定第 4 步「兜底剥前缀」已弃用：兜底会在无 anthropic 连接时误伤官方模型名——正是 cc-switch 踩过的坑。

### 文件 4：配置 `claudeCompat`（settingsRepo + settings API）

```js
claudeCompat: {
  enabled: true,          // 总开关（含列表改写与请求归一化）
  suffixMode: "auto",     // off | auto | keywords
  keywords: [],           // suffixMode=keywords 时生效，如 ["deepseek","glm"]
}
```

默认值在 `DEFAULT_SETTINGS`（settingsRepo.js），旧库无此 key 自动兜底。
`updateSettings` 对 `claudeCompat` 做一层**深度合并**——dashboard 发部分 PATCH（如只改 enabled）不会丢掉 sibling 键。

### 文件 5：管理端 UI（dashboard 设置页）

落点：**Endpoint 页**新增「Claude Compat」卡片（`EndpointPageClient.js`）：总开关 + 三态 select + keywords 编辑框（逗号分隔，保存即切 keywords 模式）。

### 文件 6：单测

`tests/unit/claude-compat-layer.test.js` — 19 用例全过：形状检测 / 归一化矩阵（官方名、路由形式、combo、大小写、退化输入）/ settings 解析兜底 / 列表改写策略（auto/keywords/off、防双后缀、display_name）。

### Phase 4（可选，后续）

失败请求入 usageHistory（status/error 字段）、延迟列——补齐对比 cc-switch 的统计差距。

## 4. 关键代码约定

- 触发判定：`req.headers.get("anthropic-version")` 存在即可（不校验值）。
- 列表侧改写放在 `buildModelsList` 输出之后的 GET handler 内，不污染 OpenAI 路径。
- 请求侧归一化放在 body 解析后、combo/account 选择前，保证后续全链路（executor、usage 记账）只见真实模型名。
- 模型存在性判断复用该路由已有的模型枚举逻辑（customModels ∪ 别名 ∪ provider models），避免第二套真相源。
- 注释风格：简短英文，标注 ponytail: 说明刻意简化处。

## 5. 部署与验收

部署流水线（已验证）：
```bash
npm run cli:pack          # 产出 ../9router-<ver>.tgz（仓库父目录）
kill <旧PIDs>
npm install -g /Users/biedongbin/workspace/github/9router-<ver>.tgz
nohup node "$HOME/.nvm/versions/node/v22.22.1/lib/node_modules/9router/cli.js" --tray --skip-update &
```

验收：
```bash
# Claude 视角：带 anthropic-version 头 → id 带 claude- 前缀、按策略带 [1m]
curl -s -H "anthropic-version: 2023-06-01" -H "Authorization: Bearer $KEY" localhost:20128/v1/models
# OpenAI 视角：不带头 → 输出与现状一致
curl -s -H "Authorization: Bearer $KEY" localhost:20128/v1/models
# messages 归一化：claude-deepseek-v4-flash → 上游收到 deepseek-v4-flash，usage 记真实名
```
最终切换：Claude Code `ANTHROPIC_BASE_URL=http://localhost:20128`，退 cc-switch 托盘。
