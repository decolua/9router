这是重新评估后的 **Safety-First MVP Roadmap**。

这版不再把 Identity 兼容看成“尽量多捕获 Header，然后尽量多重放 Header”，而是拆成两件事：

- Capture：观察 Claude Code 的真实请求形态，用来学习和刷新身份上下文。
- Replay：只把经过策略允许、适合跨请求复用的身份字段注入到目标上游。

核心原则：

- Capture 不等于 Replay。
- Replay 必须有策略分类，默认保守。
- Provider/API Key/Cookie 等认证凭据永远由当前连接决定，不能被历史 Identity 覆盖。
- Debug 和 Persistence 不能保存或暴露敏感原值。
- Auto Refresh 必须先确认来源可信，再更新 Identity。

------

## 当前代码状态评估

### 已具备的能力

当前项目已经有以下基础：

- Transparent Proxy：Claude Code 原生请求可以走透明代理路径。
- Identity Manager：已有 `claudeIdentityManager` 负责捕获、查询、清除和注入 Identity。
- Header Injection：`anthropic-compatible` provider 可通过 `injectClaudeIdentity` 开启身份注入。
- Provider Auth 优先：当前 executor 在注入 Identity 后再应用 provider auth，因此 provider 的 `Authorization` / `x-api-key` 不会被历史 Identity 覆盖。
- Debug API：已有 `/api/claude-identity` 和 `/api/claude-identity/clear`。

### 当前主要风险

1. Auto Refresh 来源校验偏弱。

当前只要 `User-Agent` 包含 `claude-cli` / `claude-code`，或 `x-app: cli`，就可能被当作 Claude Code。这个条件适合辅助识别，但不适合作为刷新全局 Identity 的唯一依据。

2. Capture 范围和 Replay 范围没有明确分层。

当前捕获会保存许多 end-to-end headers，注入时再跳过一部分 protected headers。这个方向比“全部透传”安全，但文档必须把它正式定义成策略模型，避免后续实现退化成“捕获什么就重放什么”。

3. Persistence 如果直接保存完整 Identity，会放大风险。

如果未来把 `authorization`、`cookie`、`x-api-key`、动态 request headers 或设备指纹原样写入 `identity.json`，本地文件会变成敏感凭据仓库。

4. Debug / Diff 如果输出原值，会泄露敏感信息。

Debug 很有用，但默认只能输出 header 名称、分类、计数、hash、长度、变化次数等摘要，不能输出 token/cookie 原文。

5. 单全局 Identity 的适用范围有限。

MVP 可以暂时不做完整 Identity Pool，但至少需要按 target provider/baseUrl 或 identity namespace 做隔离，否则一个来源捕获到的身份可能被注入到不该使用它的上游。

------

# 9Router Claude Identity Compatibility MVP Roadmap

## 当前状态

### 本次实施范围（2026-07-16）

本次只实施推荐开发顺序中的 ①–⑤ 与 ⑦，且继续遵循最小侵入原则：身份逻辑集中在
`open-sse/utils/claudeIdentityManager.js`，运行链仅保留捕获和注入两个接入点。

| 功能 | 实施状态 | 本次验收范围 |
| ---- | -------- | ------------ |
| ① Safety Baseline | ✅ 已完成 | 可信来源校验、鉴权后捕获、敏感值不入 raw store、Debug local-only 保护。 |
| ② Policy Classification | ✅ 已完成 | Never / Sensitive / Client Preferred / Identity / Observe 五类策略。 |
| ③ Selective Replay | ✅ 已完成 | 只注入 `identityReplay`；Provider Auth 在注入后应用。 |
| ④ Auto Refresh | ✅ 已完成 | 字段级 merge、缺失字段保留、降级保护和 stale 标记。 |
| ⑤ TTL | ✅ 已完成 | context TTL、per-header stale 和过期后停止注入。 |
| ⑦ Debug | ✅ 已完成 | redacted status、策略计数、expired / stale 状态。 |

明确不在本次范围：⑥ Safe Persistence、⑧ Identity Diff、Identity Pool、Round Robin、Replay Mode 和 Gateway Adapter。

### 审查后优化（第 4 次提交）

- Transparent Proxy 请求上游使用 `Accept-Encoding: identity`；返回时移除可能与已解压正文不一致的 `Content-Encoding` 与 `Content-Length`。
- `identityReplay` 使用显式 Header 白名单。未知的 `x-client-*`、`x-claude-*` 等字段保持 `observeOnly`，不保存原值也不注入。
- 官方 `claude` provider 使用 `claude:official` 独立 namespace；不会与 Anthropic-compatible provider node 共用身份上下文。
- 降级捕获只记录诊断信息，不刷新 context `updatedAt`，因此无法续期 TTL。

### ✅ Phase 1：Transparent Proxy（已完成）

实现目标：

```
Claude Code
        │
        ▼
9Router（Transparent Proxy）
        │
        ▼
Claude Gateway
```

特点：

- Request 不解析
- Response 不解析
- SSE 原样透传
- End-to-end Header 原样透传
- Hop-by-hop Header 必须过滤，例如 `Host`、`Content-Length`、`Connection`、`Transfer-Encoding`
- 上游认证由 provider connection 决定，不复用客户端传入的 `Authorization`
- Byte → Byte（只允许必要的模型名替换和认证头替换）

------

### ✅ Phase 2：Identity Manager（已完成）

实现目标：

```
Claude Code

↓

Capture Identity

↓

IdentityManager

↓

Cherry Studio

↓

Inject Identity

↓

Claude Gateway
```

已经支持：

- Capture Claude Identity
- Header Injection
- 非 Claude Code 客户端调用 Claude Gateway

需要补齐的安全基线：

1. 来源校验统一入口。

提供一个明确函数，例如：

```ts
isTrustedClaudeIdentitySource(request, body, authContext)
```

它不应该只看 UA，而应该综合：

- 请求已通过 9Router API key 校验，或来自明确可信的本地入口。
- endpoint 是 Claude API 形态，例如 `/v1/messages`。
- body 是 Claude message request 形态。
- `User-Agent` / `x-app` / `anthropic-version` / `anthropic-beta` 等信号组合匹配。
- 可选：只允许 Transparent Proxy 成功路径或本地 Claude Code 请求刷新 Identity。

2. Sensitive fields 永不保存原值。

以下字段默认不进入 identity raw store：

- `authorization`
- `proxy-authorization`
- `x-api-key`
- `cookie`
- `set-cookie`
- `x-9r-*`
- `x-forwarded-*`
- `cf-*`
- `fly-*`
- `vercel-*`

3. Debug API 必须受保护。

`GET /api/claude-identity` 和 clear API 至少要满足一个条件：

- 只允许 local request。
- 或需要 dashboard auth / CLI token。
- 或在生产默认关闭。

4. Identity 数据结构要预留分类。

```ts
interface IdentityContext {
  namespace: string;
  headers: Record<string, IdentityHeader>;
  metadata: {
    createdAt: number;
    updatedAt: number;
    lastUsedAt?: number;
    captureCount: number;
    sourceConfidence: "low" | "medium" | "high";
  };
}

interface IdentityHeader {
  name: string;
  value?: string;
  valueHash?: string;
  policy: "neverReplay" | "sensitiveClientPreferred" | "clientPreferred" | "identityReplay" | "observeOnly";
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
  changedCount: number;
  persisted: boolean;
}
```

------

# Phase 3：Identity Auto Refresh（调整为安全刷新）

## 原计划的问题

原计划是：

```
每次 Claude Code 请求
  -> 自动覆盖 Headers / Cookie / Metadata
```

这个策略太激进：

- 伪造 Claude Code Header 的请求可能污染 Identity。
- 某次请求 Header 更少时，会把原本可用的 Identity 缩水。
- Cookie / Authorization 过期刷新如果原样保存，会引入凭据泄露风险。
- 全量覆盖无法区分稳定身份字段和每次变化的动态字段。

## 新目标

改成：

```
可信 Claude Code 请求
        |
        v
字段级刷新 Identity
        |
        v
只更新允许捕获的字段
        |
        v
缺失字段不立即删除
```

## 实现要求

1. 先鉴权，再刷新。

如果 `requireApiKey=true`，请求必须通过 API key 校验后才能刷新 Identity。

2. 可信来源才刷新。

只有 `isTrustedClaudeIdentitySource(...) === true` 的请求可以刷新 Identity。

3. 字段级 merge，不做全量覆盖。

- 新出现的 header：按 Phase 4 策略分类。
- 已存在且值变化：更新 `lastSeenAt`、`changedCount`，是否更新原值取决于 policy。
- 本次缺失的 header：只更新 observation，不立即删除。
- 连续多次缺失才标记 stale。

4. 设置降级保护。

如果一次 refresh 捕获到的 identity header 数量明显少于当前有效 identity，例如少 50% 以上，不直接覆盖核心字段，只记录异常。

5. namespace 隔离。

MVP 至少按 target baseUrl/provider node 存储：

```yaml
identity:
  namespace: anthropic-compatible:<providerNodeId>
```

如果暂时做不到 per-node，至少不要把 identity 自动注入到所有 anthropic-compatible provider。

## 收益

- 自动适配 Claude Code 更新。
- 降低身份污染风险。
- 避免偶发请求导致 identity 退化。

------

# Phase 4：Adaptive Identity Capture & Selective Replay（替换原方案）

## 原计划的问题

原计划：

```
除 Host / Authorization / Content-Length / Transfer-Encoding / Connection 外
其它 Header 全部自动 Capture
```

这个方案的问题是：

- “全部 Capture”容易包含动态、敏感、代理层、部署平台、调试类 Header。
- 文档没有明确哪些 Header 可以 Replay。
- 未知 Header 如果默认 Replay，会把未来兼容能力变成未来风险。

## 新目标

自动捕获身份相关 Header，但 Replay 必须按策略选择性注入：

```ts
type HeaderPolicy =
  | "neverReplay"
  | "sensitiveClientPreferred"
  | "clientPreferred"
  | "identityReplay"
  | "observeOnly";
```

## Header 分类

### Never Replay

协议层、连接层、代理层、平台层 Header。永不保存原值，永不注入。

示例：

- `host`
- `content-length`
- `connection`
- `keep-alive`
- `transfer-encoding`
- `te`
- `trailer`
- `upgrade`
- `proxy-authenticate`
- `proxy-authorization`
- `x-forwarded-*`
- `x-real-ip`
- `x-9r-*`
- `cf-*`
- `fly-*`
- `vercel-*`

### Sensitive Client Preferred

由当前客户端或当前 provider connection 决定。默认不保存原值，不持久化，不 debug 原值，不从 Identity Replay。

示例：

- `authorization`
- `x-api-key`
- `cookie`
- `set-cookie`

### Client Preferred

由当前请求语义决定。可以观察，但注入时默认保留当前客户端或 executor 生成值。

示例：

- `accept`
- `content-type`
- `accept-encoding`
- `content-encoding`
- `cache-control`

### Identity Replay

明确属于 Claude Code 身份外观，允许注入。

示例：

- `user-agent`
- `anthropic-version`
- `anthropic-beta`
- `anthropic-dangerous-direct-browser-access`
- `x-app`
- `x-stainless-*`
- `x-claude-*`
- `x-client-version`

### Observe Only

未知 Header 默认进入观察态。

行为：

- 记录 header name。
- 记录 value hash / length / firstSeen / lastSeen / seenCount / changedCount。
- 默认不保存原值。
- 默认不 replay。
- 只有满足稳定性和命名规则后，才允许提升为 `identityReplay`。

## Unknown Header 提升规则

未知 Header 要进入 Replay，至少满足：

- 不在 never/sensitive/clientPreferred 分类中。
- 名称匹配身份相关前缀，例如 `anthropic-*`、`x-claude-*`、`x-client-*`、`x-stainless-*`。
- 连续 N 次可信 Claude Code 请求中出现。
- 值稳定，或变化模式明确属于版本/会话类身份字段。
- Debug 中能看到它处于 `candidate` 状态，由测试或配置确认后再 replay。

当前 MVP 的实现更保守：未知 Header 即使名称匹配上述前缀也只进入 `observeOnly`，不会自动晋级。
需要新增重放字段时，必须加入显式白名单并补充测试，以避免未来凭据类 Header 被意外保存或注入。

## Replay 合并规则

注入时优先级：

```
Provider Auth > Current Client Semantic Headers > Identity Replay Headers > Static Provider Defaults
```

特殊规则：

- `anthropic-beta` 可以 merge 去重。
- `authorization` / `x-api-key` / `cookie` 永远不由 identity 覆盖。
- `accept` 和 `content-type` 默认由当前 executor/request 决定。

------

# Phase 5：Identity Persistence（从默认保存改为显式安全保存）

## 原计划的问题

原计划是默认保存：

```yaml
identity:
  persistence: true
  file: identity.json
```

风险：

- 可能把 token/cookie 写入磁盘。
- 可能保存过期或污染过的 identity。
- 多 provider 共用一个文件会串 identity。

## 新目标

Persistence 默认关闭，或只保存安全摘要。

推荐：

```yaml
identity:
  persistence: false
  persistMode: safe
```

## 保存内容

允许保存：

- `identityReplay` headers 的原值。
- `observeOnly` headers 的 name/hash/metadata，不保存原值。
- metadata：`createdAt`、`updatedAt`、`captureCount`、`namespace`。
- policy 分类。

禁止保存原值：

- sensitive headers。
- neverReplay headers。
- cookie。
- authorization。
- x-api-key。
- proxy headers。

## 文件隔离

按 namespace 保存：

```text
identity/
  anthropic-compatible-<nodeId>.json
```

## 文件安全

- 文件权限尽量限制为当前用户可读写。
- Debug log 只打印路径和 header count，不打印原值。
- 加载失败时 fail closed：不注入 identity，等待重新捕获。

------

# Phase 6：Identity TTL（保留，但按 Header 分类细化）

## 原计划的问题

单一 TTL 太粗。

有些字段长期稳定：

- `anthropic-version`
- `x-stainless-lang`
- `x-stainless-runtime`

有些字段经常变化：

- `user-agent`
- `x-stainless-package-version`
- session-like headers

## 新目标

支持 context TTL + per-header stale 状态。

```yaml
identity:
  ttl: 24h
  staleAfter: 6h
```

## 行为

- Context 超过 `ttl`：停止 Injection，等待可信 Claude Code 请求刷新。
- Header 超过 `staleAfter`：仍可显示，但注入时可按 policy 决定是否跳过。
- 新捕获请求可信但 header 数减少：不立即删除旧 header，先标记 stale。

## Debug 状态

```json
{
  "status": "healthy",
  "expired": false,
  "staleHeaderCount": 2,
  "headerCount": 18
}
```

------

# Phase 7：Identity Debug（必须 Redacted + Authenticated）

## 原计划的问题

只写 `GET /identity` 不够。Debug API 一旦输出原值，就会泄露身份信息。

## 新目标

新增或保留：

```text
GET /api/claude-identity
POST /api/claude-identity/clear
```

但必须：

- 受 dashboard auth / local request / CLI token 保护。
- 默认不返回 header value。
- 支持 `debug.identity=true` 时输出更详细摘要，但仍不输出 sensitive 原值。

## 默认返回

```json
{
  "hasIdentity": true,
  "namespace": "anthropic-compatible:node-id",
  "status": "healthy",
  "headerCount": 18,
  "replayableHeaderCount": 12,
  "observeOnlyHeaderCount": 3,
  "neverReplayHeaderCount": 8,
  "capturedAt": 1760000000000,
  "updatedAt": 1760000010000,
  "lastInjectedAt": 1760000020000,
  "expired": false,
  "sourceConfidence": "high"
}
```

## Header 列表

只返回：

```json
{
  "name": "x-stainless-package-version",
  "policy": "identityReplay",
  "seenCount": 12,
  "changedCount": 1,
  "valueHash": "sha256:..."
}
```

------

# Phase 8：Identity Diff（降级为诊断工具，默认关闭）

## 原计划的问题

Diff 很有用，但也最容易泄露：

- 原始请求 Header。
- 注入后的 Provider Header。
- Cookie / Authorization。
- 客户端设备指纹。

## 新目标

Diff 默认关闭，只做 redacted diff。

```yaml
debug:
  identityDiff: false
```

## Diff 输出

允许：

- Added / Removed / Modified 的 header names。
- policy 分类。
- value hash 是否变化。
- 是否被注入。
- skip reason。

禁止：

- Authorization 原值。
- Cookie 原值。
- x-api-key 原值。
- 完整 request body。

## 示例

```text
Identity Diff

Added:
  x-stainless-package-version [identityReplay]

Modified:
  user-agent [identityReplay] hash_changed=true

Skipped:
  authorization [sensitiveClientPreferred]
  content-type [clientPreferred]
  content-length [neverReplay]
```

------

# 暂缓功能重新评估

## Identity Pool

原先认为没有意义，因为只有一个 Claude Identity。

修正：

完整 pool 可以暂缓，但 MVP 至少需要 namespace 隔离。

推荐暂不做 UI Pool，但内部结构必须支持：

- per provider node
- per baseUrl
- per source identity

## Round Robin

继续暂缓。

没有多个可信 Identity 之前，不做轮询。

## Replay Mode

原计划暂缓是对的。

但 Phase 4 的 selective replay 已经是必要能力，不应该再把 replay 完全视为后期功能。

## Gateway Adapter

继续暂缓。

当前只服务 Anthropic/Claude-compatible 网关即可。

## Compatibility Score

继续暂缓。

Debug 状态和 Diff 足够支撑 MVP 排查。

------

# 最终架构

```
Claude Code
        │
        ▼
Trusted Source Check
        │
        ▼
Identity Auto Refresh
        │
        ▼
Adaptive Capture
        │
        ▼
Policy Classification
        │
        ▼
Safe Persistence / TTL
        │
        ▼
Selective Replay
        │
        ▼
Claude Gateway
```

------

# Provider 配置建议

```yaml
providers:
  - type: anthropic-compatible
    base_url: https://cc.freemodel.dev/v1
    transparent: true
    inject_claude_identity: true

identity:
  auto_refresh: true
  adaptive_capture: true
  persistence: false
  persist_mode: safe
  ttl: 24h
  stale_after: 6h
  namespace: provider-node

debug:
  identity: false
  identity_diff: false
```

说明：

- `transparent` 和 `inject_claude_identity` 是两个不同能力。
- `transparent` 用于 Claude Code 原生请求无损转发。
- `inject_claude_identity` 用于非 Claude Code 客户端选择性复用身份 Header。
- `persistence` 默认建议关闭；如果开启，只能使用 safe mode。

------

# 推荐开发顺序

| 顺序 | 功能 | 工作量 | 风险降低 | 建议 |
| ---- | ---- | ------ | -------- | ---- |
| ✅ | Transparent Proxy | 已完成 | 中 | 保留 |
| ✅ | Identity Manager | 已完成 | 中 | 保留 |
| ✅ | Safety Baseline：来源校验 + Debug 鉴权 + Sensitive redaction | 小 | ⭐⭐⭐⭐⭐ | 已完成 |
| ✅ | Policy Classification：Never / Sensitive / Client Preferred / Identity / Observe | 小 | ⭐⭐⭐⭐⭐ | 已完成 |
| ✅ | Selective Replay：按策略注入，Provider Auth 永远优先 | 小 | ⭐⭐⭐⭐⭐ | 已完成 |
| ✅ | Auto Refresh：可信来源 + 字段级 merge + stale 标记 | 中 | ⭐⭐⭐⭐☆ | 已完成 |
| ✅ | TTL：context TTL + per-header stale | 小 | ⭐⭐⭐⭐☆ | 已完成 |
| ⑥ | Safe Persistence：默认关闭，只保存安全字段 | 中 | ⭐⭐⭐☆☆ | 谨慎实现 |
| ✅ | Debug：redacted status + counts + policy | 小 | ⭐⭐⭐☆☆ | 已完成 |
| ⑧ | Diff：redacted diagnostic，默认关闭 | 中 | ⭐⭐☆☆☆ | 有需要再做 |

------

# 最小可交付 MVP

第一版 MVP 不需要一次做完 Phase 5-8。

建议最小实现：

1. 收紧 `isClaudeCodeClient`，新增可信来源判断。
2. 捕获前过滤 sensitive / neverReplay 原值。
3. 引入 Header policy 分类。
4. 注入时只 replay `identityReplay`。
5. `authorization` / `x-api-key` / `cookie` 永远由当前连接决定。
6. Debug API 加保护，只返回 redacted summary。
7. 不做默认 persistence。

这样可以同时满足两个目标：

- Claude Code 未来新增身份 Header 时，9Router 能观察并逐步适配。
- 不会因为“自动适配”把协议 Header、动态 Header、敏感凭据一起复用出去。
