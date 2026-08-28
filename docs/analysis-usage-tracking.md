# 9router API 用量统计数据链路分析

> 分析日期：2026-08-24。分析对象：仓库源码（v0.5.55 线）。

## 0. 核心结论

**CLAUDE.md 中「usage/logs 走 usage.json + log.txt、不跟随 DATA_DIR」的描述已过时。** usage 已完全迁移至 SQLite：

- `src/lib/usageDb.js` 仅是 7 行 shim，re-export `src/lib/db/index.js`
- 库文件：`{DATA_DIR}/db/data.sqlite`（`src/lib/db/paths.js:5-6`），默认 `~/.9router`，可被 env `DATA_DIR` 覆盖——**如今跟随 DATA_DIR**
- 旧 `usage.json` / `request-details.json` 仅在首次启动新库时一次性导入（`src/lib/db/migrate.js:257-294`）
- `log.txt` 已废弃，`appendRequestLog()` 为空函数，日志读取时从 `usageHistory` 表即时派生（`src/lib/db/repos/usageRepo.js:739-740`）

Driver 链（`src/lib/db/driver.js:58-64`）：better-sqlite3 → node:sqlite(≥22.5) → sql.js；Bun 下 bun:sqlite → sql.js。WAL 模式。

## 1. 数据流

```
客户端 → /v1/chat/completions | /v1/messages (src/sse/handlers/chat.js:262)
  └→ open-sse/handlers/chatCore.js (handleChatCore)
      ├─ 鉴权/选号: src/sse/services/auth.js (round-robin sticky)
      │    └→ updateProviderConnection: consecutiveUseCount/lastUsedAt
      │       写 providerConnections.data (SQLite)
      ├─ 请求开始: trackPendingRequest (仅内存, usageRepo.js:152)
      ├─ 成功(流式):   chatCore/streamingHandler.js:139 → saveUsageStats
      ├─ 成功(非流式): chatCore/nonStreamingHandler.js:321 → saveUsageStats
      ├─ 成功(强制流→JSON/responses): sseToJsonHandler.js:207/:307 → saveUsageStats
      │    saveUsageStats (chatCore/requestDetail.js:97-127)
      │    └→ saveRequestUsage (usageRepo.js:241-314)
      │        单事务三写: ① usageHistory INSERT ② usageDaily upsert ③ _meta.totalRequestsLifetime++
      │        成本: pricingRepo.getPricingForModel + open-sse/providers/pricing.js
      ├─ 成功: saveRequestDetail → requestDetails 表(observability 开关+批量缓冲, 默认关)
      └─ 失败 (chatCore.js:354-366, 411-430):
           ├→ saveRequestDetail(status fail) → requestDetails(若开启)
           ├→ appendRequestLog → NO-OP(失败不落 usageHistory)
           └→ markAccountUnavailable (auth.js:219-264)
                → providerConnections.data: modelLock_<model>/rateLimitedUntil/backoffLevel/lastError

embeddings 独立路径: src/sse/handlers/embeddings.js:140 直接调 saveRequestUsage
images/video/stt/tts/search: 无任何 usage 写入

查询侧: dashboard → /api/usage/* → getUsageStats/getChartData/getRecentLogs
```

## 2. 表结构

### usageHistory（每请求一行，schema.js:109-131）

| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| timestamp | TEXT | ISO 时间 |
| provider | TEXT | 如 `claude`/`codex` |
| model | TEXT | 原始模型名 |
| connectionId | TEXT | 账号(connection)ID |
| apiKey | TEXT | 明文存，读取时打码（maskApiKey, usageRepo.js:6-10） |
| endpoint | TEXT | 如 `/v1/messages`（事后 UPDATE 回填, usageRepo.js:274-278） |
| promptTokens / completionTokens | INTEGER | 含 cache（cache-inclusive 约定） |
| cost | REAL | 写入时按 pricing 表即时算，查不到价则 0 |
| status | TEXT | 成功路径恒为 `"ok"` |
| tokens | TEXT(JSON) | `prompt_tokens, completion_tokens, cached_tokens, cache_read_input_tokens, cache_creation_input_tokens, reasoning_tokens`（canonicalizeUsage, open-sse/utils/usageTracking.js:164） |
| meta | TEXT(JSON) | 恒 `{}` 占位 |

索引：timestamp DESC / provider / model / connectionId。**无保留策略、无 DELETE、无限增长。**

### usageDaily（每日聚合，主键 dateKey=YYYY-MM-DD 本地时区）

data JSON（usageRepo.js:63-98 aggregateEntryToDay）：

```
{ requests, promptTokens, completionTokens, cachedTokens, cost,
  byProvider: {prov → 计数器},
  byModel:    {"model|provider" → 计数器 + {rawModel, provider}},
  byAccount:  {connectionId → 计数器 + {rawModel, provider}},
  byApiKey:   {"apiKey|model|provider" → 计数器 + {rawModel, provider, apiKey}},
  byEndpoint: {"endpoint|model|provider" → 计数器 + {...}} }
计数器 = {requests, promptTokens, completionTokens, cachedTokens, cost}
```

### requestDetails（可观测明细，schema.js:138-154；requestDetailsRepo.js）

| 列 | 说明 |
|---|---|
| id / timestamp / provider / model / connectionId / status | 冗余列（供 SQL 过滤） |
| data(JSON) | `{latency:{ttft,total}, tokens, request(headers 脱敏+5KB 截断), providerRequest, providerResponse, response, pxpipe}` |

默认**关闭**（settings.enableObservability / env REQUEST_LOGS），容量上限默认 200 条（环形淘汰），批量缓冲写（20 条或 5s flush）。

## 3. 聚合维度现状

### 已支持（getUsageStats, usageRepo.js:346-659）

- **byProvider / byModel / byAccount(connectionId→名称解析) / byApiKey(打码+keyName) / byEndpoint** —— 五维齐全
- 前端（src/shared/components/UsageStats.js:324-411）有 Model/Account/API Key/Endpoint 四个分组视图
- 时间段：`today`/`24h`（走 usageHistory 实时行）与 `7d`/`30d`/`60d`/`all`（走 usageDaily 预聚合）双轨
- 图表：today/24h 按小时桶，7d/30d/60d 按天桶（tokens+cost）
- request-details 查询参数：provider/model/connectionId/status/startDate/endDate/分页
- 实时：pending（内存）、last10Minutes 分钟桶、recentRequests（去重 20 条）、SSE 推送（/api/usage/stream，防抖 150/250ms）

### 缺失

1. **失败请求零落库**：失败只进 requestDetails（默认关）与内存计数；`usageHistory.status` 恒 `"ok"` → 无成功率/错误维度
2. **耗时/延迟不入 usageHistory**：latency(ttft/total) 只在 requestDetails；无法按模型/账号算 P50/P99
3. **images/video/tts/stt/search 无 usage 记录**
4. **按 API key × 按天交叉查询无 API**：usageDaily JSON 里存了 byApiKey，但无 route 暴露按天×key 原始数据；`/api/usage/history` 不透传 provider/model/日期过滤参数
5. **无 hourly×维度图表**（chart 仅全局 tokens/cost）
6. **无数据保留/TTL/归档**；无 cache-creation 独立成本列
7. **fallback 重试期间失败尝试不记录**——每账号成功一次才记一行，失败次数与归属账号丢失（只 markAccountUnavailable）

## 4. 关键写入点

| 时机 | 位置 |
|---|---|
| 流式完成（含 usage 提取） | open-sse/handlers/chatCore/streamingHandler.js:139 |
| 非流式成功 | open-sse/handlers/chatCore/nonStreamingHandler.js:321 |
| Responses/SSE→JSON | open-sse/handlers/chatCore/sseToJsonHandler.js:207, :307 |
| 统一入库封装 saveUsageStats | open-sse/handlers/chatCore/requestDetail.js:97-127 |
| 三写事务 saveRequestUsage（含判重） | src/lib/db/repos/usageRepo.js:241-314 |
| 成本计算 | usageRepo.js:134-150 → open-sse/providers/pricing.js |
| embeddings | src/sse/handlers/embeddings.js:140 |
| 明细缓冲写 saveRequestDetail | src/lib/db/repos/requestDetailsRepo.js:143-160 |
| 失败路径（只记 detail） | open-sse/handlers/chatCore.js:354-366, :411-430 |
| pending 内存计数 | chatCore.js:293/:301/:304/:355/:418; open-sse/utils/stream.js:343 |

## 5. quota 与 usage 的关系

**同库不同表，写点解耦。**

- 熔断状态（`consecutiveUseCount`、`rateLimitedUntil`、`modelLock_<model>`、`backoffLevel`、`lastError`）存 `providerConnections.data` JSON 列（connectionsRepo.js）
- sticky round-robin：选号读写 `consecutiveUseCount`（auth.js:131-175）
- 熔断：`markAccountUnavailable`（auth.js:219-264）——429/5xx 指数退避，或 codex `resets_at`/GitHub 月度重置精确覆盖；成功后 `clearAccountError` 清锁
- 上游真实配额（Codex 5h 窗口、Claude 配额）由 `open-sse/services/usage.js` 的 `getUsageForProvider` 拉供应商 API，经 `/api/usage/[connectionId]`（route.js:126-186）供 ProviderLimits 组件展示——**不入库，仅缓存/实时**，与本地 usage 统计两套体系

## 6. 与 cc-switch 的调用明细对比（2026-08-24）

cc-switch 有 per-request 明细表 `proxy_request_logs`（SQLite，26 列，`src-tauri/src/database/schema.rs:197-211`），全部统计由该表 GROUP BY 派生（`services/usage_stats.rs`）。

| 维度 | cc-switch | 9router |
|---|---|---|
| per-request 明细 | 有（`proxy_request_logs` 26 列） | 有（`usageHistory` 每请求一行） |
| provider/渠道 | provider_id | provider |
| api key | **无字段**（同 provider 多 key 不可区分） | apiKey |
| connection/账号 | 无 | connectionId |
| session | session_id（有列有索引，UI 不可查） | — |
| app/端类型 | app_type（claude/codex/gemini/…） | endpoint |
| 模型 | model（响应归因）/ request_model（请求别名）/ pricing_model（计价）三体系 | model |
| tokens | input/output/cache_read/cache_creation + input_token_semantics | tokens JSON（4 项 + reasoning） |
| 成本 | 5 项拆分 + cost_multiplier + Decimal | cost 单值 |
| 耗时 | latency_ms / first_token_ms / duration_ms | —（仅 requestDetails，默认关） |
| 失败记录 | status_code + error_message（tokens 记 0） | —（不落 usageHistory） |
| 流式标记 | is_streaming | — |
| 留存 | 明细 30 天 → 聚合 `usage_daily_rollups` 后 prune（`dao/usage_rollup.rs:62`） | 无 prune，无限增长 |
| 数据来源 | 代理实时 + 会话 JSONL 回填（`services/session_usage.rs` 解析 ~/.claude/projects/**.jsonl）双链路 | 仅代理流量 |

cc-switch 写入点：`UsageLogger::log_request`（`proxy/usage/logger.rs:101`，INSERT OR IGNORE + SHA-256 去重）；成功 `response_processor.rs:657` / `handlers.rs:2658`，失败 `handlers.rs:2604`。归因优先级：usage.model → 响应 model 字段 → outbound_model → request_model。

**结论**：「有明细则所有维度统计都能做」成立，但维度上限受记录字段限制——cc-switch 缺 api key 与 connection 归因（不可补做）；9router 缺耗时/失败/流式/多模型名体系（可从 requestDetails 搬运补齐）。9router 若要追平 cc-switch 的统计能力，需补：① 失败请求落 usageHistory（status/error）② latency 列 ③ rollup+prune 留存策略。

## 7. 关键文件清单

- `src/lib/usageDb.js` — shim
- `src/lib/db/schema.js` — 表定义
- `src/lib/db/repos/usageRepo.js` — 读写核心
- `src/lib/db/repos/requestDetailsRepo.js` — 可观测明细
- `src/lib/db/paths.js` / `src/lib/dataDir.js` / `src/lib/db/driver.js` / `src/lib/db/migrate.js` — 库位置/driver/迁移
- `open-sse/handlers/chatCore.js` + `chatCore/*` — 主链路写入
- `open-sse/utils/usageTracking.js` — usage 规范化
- `src/sse/handlers/embeddings.js` / `src/sse/services/auth.js`
- `src/app/api/usage/*` — 查询 API
- `src/app/(dashboard)/dashboard/usage/` + `src/shared/components/UsageStats.js` — 展示层
