# cc-switch 模型代理逻辑分析（claude- 前缀机制）

> 分析日期：2026-08-24。对象：/Users/biedongbin/workspace/github/cc-switch（基于上游 v3.19.0，HEAD=4bfb3fc3，含本地未提交修改）。

## 0. 核心结论

**`claude-` 前缀 + `[1M]` 后缀逻辑全部是本地未提交的修改（dirty diff），上游 cc-switch v3.19.0 本身没有此功能。** 工作区仅两个文件 dirty：`src-tauri/src/proxy/handlers.rs`（+119/-5）与 `src-tauri/src/proxy/server.rs`（1 行），全部为 claude-gateway 改动（含 `[claude-gateway]` 中文日志）。但官方代码里有完整同类机制（Claude Desktop 路由 + `[1m]` 后缀），可互为印证。

## 1. 架构概览

- **Tauri 2 桌面应用**：React 前端（`src/`）+ Rust 后端（`src-tauri/`），内嵌 **axum 本地代理服务器**（`src-tauri/src/proxy/server.rs`）
- 默认监听 `127.0.0.1:15721`（`proxy/types.rs:45-46`，DB 默认值 `schema.rs:129`，端口 0 时动态分配）
- 接管模式：改写 Claude Code `~/.claude/settings.json` 的 `ANTHROPIC_BASE_URL` 指向本机代理；上游 URL 从当前 provider 的 `settings_config.env.ANTHROPIC_BASE_URL` 提取（`forwarder.rs:1127`，`providers/claude.rs:829 build_url`）
- 路由表（`server.rs:291-359`）：`/v1/messages`（Claude）、`/claude-desktop/v1/*`、`/v1/chat/completions`、`/v1/models`、`/v1/responses`（Codex）、Gemini `any(..)` 等
- 当前链路：**Claude Code → cc-switch(15721) → 9router(localhost:20128) → 真实上游**。cc-switch 对 messages 纯透传 Anthropic 格式（OpenRouter 转换默认关闭，`handlers.rs:112-116`），Anthropic↔OpenAI 转换由 9router 完成

## 2. claude- 前缀精确规则（本地未提交修改）

### 列表侧（handlers.rs:3372-3456 `handle_claude_gateway_models`，挂载于 server.rs:324）

- GET `http://localhost:20128/v1/models`（**硬编码** 9router 地址，5s 超时）
- 对每个 `data[].id` **无条件**改写为 `claude-{original_id}`（handlers.rs:3424）
- 附加规则（handlers.rs:3426-3434）：original_id 小写包含 `deepseek` 或 `glm-5.2` 时追加 `[1M]` 后缀 → 如 `claude-deepseek-v4[1M]`
- 同时写入 `real_id`（原始 ID）和 `display_name`（原始 ID + `[1M]`，列表显示干净）

### 请求侧（handlers.rs:177-197 `handle_messages_for_app`，覆盖 /v1/messages 与 /claude-desktop/v1/messages）

1. `strip_suffix("[1M]")` —— **大小写敏感**（只匹配大写，与官方不敏感实现不一致，有 bug 面）
2. `strip_prefix("claude-")` —— **无条件**剥离
3. 替换 `body.model` 后才进入 RequestContext / forwarder

**无条件对所有请求生效**——真官方名 `claude-sonnet-4-5` 也会被剥成 `sonnet-4-5`（当前上游是 9router 所以无碍，属已知局限）。

### 响应侧

纯透传，不把前缀加回；`model` 字段只用于 usage 归因（`response_processor.rs:238-296`）。

## 3. 官方（已提交）的同类机制——佐证「为什么需要前缀」

- **`[1m]` 后缀是官方功能**：`model_mapper.rs:147-172` `strip_one_m_suffix_for_upstream`（大小写**不敏感** `eq_ignore_ascii_case`），注释「Claude Code 通过 `[1M]` 后缀声明 100 万上下文能力；上游 API 通常不接受这个本地能力标记，转发前需要剥离」。`forwarder.rs:1192` 转发前调用。issue #3980：Claude Code 实际会发 `claude-fable-5[1m]` 形态
- **`claude-` 前缀是 Claude Desktop 官方机制**：`claude_desktop_config.rs:28` `CLAUDE_ROUTE_PREFIX: &str = "claude-"`，注释「**Claude Desktop 模型菜单识别的 route ID 前缀**」；`:30` 备用前缀 `anthropic/claude-`；`:518` 错误文案「Claude Desktop 直连模型必须使用 claude-* 或 anthropic/claude-* 名称」；`:250-253` Claude Desktop 1.12603.1+ 的 **fail-all validator** 角色白名单 `["sonnet","opus","haiku","fable","mythos"]`（app.asar 内）——即 Anthropic 客户端**只识别/只接受 `claude-*` 形态模型名，非 claude- 名直接整组拒绝**
- **官方闭环**（可作 9router 设计参考）：`model_list_response`（claude_desktop_config.rs:650-684）返回 `route_id`（`claude-*`）+ `supports1m: true` 字段；请求侧 `map_proxy_request_model`（:686-730）把 route_id 查表映射回 `upstream_model`，含带日期全名→短 route_id 的角色关键词宽松回落
- 角色映射另有 `model_mapper.rs` `ModelMapping`：用 `ANTHROPIC_DEFAULT_SONNET_MODEL` 等 env 把 `claude-sonnet-*` 映射到任意上游模型

## 4. 与 /v1/messages 的关系

cc-switch 默认**不伪装格式**。`handle_messages_for_app` 判断 `needs_transform`（handlers.rs:249-265），仅 OpenRouter 旧接口场景做 Anthropic↔OpenAI 转换，否则纯透传。当前链路中格式转换在 9router 侧完成。

## 5. git 修改痕迹

- HEAD = `4bfb3fc3`（v3.19.0）
- 工作区 dirty：`src-tauri/src/proxy/handlers.rs`（+119/-5）+ `src-tauri/src/proxy/server.rs`（1 行）——全部即上述 claude-gateway 改动
- 上游 git 历史中 `/v1/models` 从无加前缀逻辑；`claude-` 前缀相关提交集中在 Claude Desktop 路由（b4f57f7e1 role-based model mapping with 1M flag 等）

## 6. Claude Code 客户端实证（二进制逆向 v2.1.235，2026-08-24）

对本地 Claude Code 二进制（`~/.local/share/claude/versions/2.1.235`，Mach-O）grep 字符串 + 反混淆，验证客户端真实行为：

### 6.1 `/v1/models` 只解析 `id` + `display_name`

gatewayDiscovery 拉 `{base_url}/v1/models?limit=1000`（带 `anthropic-version: 2023-06-01` 头）后：

```js
z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().optional() }).strip())
}).safeParse(body)
```

`.strip()` 丢弃其余一切字段——`context_length` / `max_completion_tokens` / `capabilities` / `owned_by` / `real_id` 对 Claude Code **全部无效**。二进制中 `contextLength` 仅 2 处命中，均为 agent transcript 消息数组长度，与模型窗口无关。

### 6.2 id 强制正则过滤——`claude-` 前缀是硬性必要

```js
const usable = data.filter((p) => /(claude|anthropic)/i.test(p.id));
if (usable.length === 0) return;  // "[gatewayDiscovery] 0 usable models after filter"
```

**id 必须含 `claude` 或 `anthropic` 子串，否则整组丢弃**。9router 不改写 id 则 Claude Code 看不到任何非 claude 模型。注意是子串匹配非前缀匹配（`anthropic/claude-x`、`myclaude-x` 也能过）。

### 6.3 `[1m]` 后缀是 beta header 开关，context_length 无法替代

```js
function bl(e){ return e.replace(/\[1m\]$/i, "") }   // 剥离，大小写不敏感
UKe = ["sonnet","opus","haiku","fable","best","sonnet[1m]","opus[1m]","fable[1m]","opusplan"]
iJt(){ return "opus" + (Jj() ? "[1m]" : "") }
// 二进制同时含 "context-1m-2025-08-07" beta header 值
```

- `[1m]` 是模型名语法成分：选中带后缀模型 → 请求带 `anthropic-beta: context-1m-2025-08-07` → 上游启用 1M 窗口
- **`context_length` 字段无法触发该 header**——它是信息层（客户端也不读），`[1m]` 是协议层开关
- **结论：`[1M]` 后缀必要**，目的是让 Claude Code 对指定模型启用 1M context beta
- Claude Code 剥离是 `/\[1m\]$/i` 不区分大小写；cc-switch 请求侧 `strip_suffix("[1M]")` 只匹配大写——列表统一发 `[1M]` 时恰好闭环，用户手写小写 `xxx[1m]` 时剥不掉（隐患）

## 7. 9router 复刻行为清单

1. **models 列表改写**：`GET /v1/models`（Anthropic 客户端视角）将 `data[].id` 改写为 `claude-<original>`；建议同时输出 `real_id` / `display_name`，并支持 `supports1m: true` 字段（Claude Desktop 协议）而非只靠 `[1M]` 后缀
2. **1M 标记**：列表侧可对长上下文模型追加 `[1M]`；请求侧剥离用**大小写不敏感**匹配（cc-switch hack 只匹配大写，官方 matcher 不敏感，前者有 bug 面）
3. **请求剥离顺序**：先去 `[1m]` 后缀 → 再去 `claude-` 前缀 → 再走现有模型路由；兼容 `anthropic/claude-` 双前缀
4. **防误剥**（cc-switch 已知缺陷）：`claude-sonnet-4-5` 会被剥成 `sonnet-4-5`。9router 应仅在「`claude-<x>` 由列表中真实模型 `<x>` 派生」时剥离，官方 claude 模型原样透传
5. **响应不回写前缀**（cc-switch 即如此），usage 归因可用剥离前名字
6. **前缀规则与 1M 模型名单做成配置**，别像 cc-switch 硬编码 `localhost:20128`
