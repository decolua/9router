# 9router 缓存 Token 丢失修复 — 2026-08-25

## 问题描述

用户通过 9router 调用 Google Antigravity/Gemini 模型时，下游客户端（Claude Code、Cursor 等）始终显示 `0 cached tokens`。Google 服务端实际返回了 `usageMetadata.cachedContentTokenCount`，但 9router 在转发过程中丢失。

## 根因（3 处 + 3 处遗漏）

### 原始 3 处缺陷（Patch 0001）

1. **`filterUsageForFormat` 白名单过滤丢弃缓存字段**
   - 文件：`open-sse/utils/usageTracking.js`
   - 问题：Gemini 规范化后的 `cached_tokens` / `prompt_tokens` 不在 Claude 白名单中，过滤后全丢
   - 修复：在白名单过滤前增加跨格式字段适配层：
     - Claude 方向：`cached_tokens` → `cache_read_input_tokens`，`input_tokens = prompt - cached - cacheCreate`
     - OpenAI 方向：补齐 `prompt_tokens_details: { cached_tokens }`

2. **`extractUsage` Gemini 分支缺少 `prompt_tokens_details`**
   - 文件：`open-sse/utils/usageTracking.js`
   - 问题：只写了根级 `cached_tokens`，未补齐 OpenAI 规范要求的嵌套结构
   - 修复：输出 `prompt_tokens_details: cachedTokens ? { cached_tokens: cachedTokens } : undefined`

3. **非流式 Gemini 分支丢弃 `cachedContentTokenCount`**
   - 文件：`open-sse/handlers/chatCore/nonStreamingHandler.js`（`translateNonStreamingResponse` Gemini 分支）
   - 问题：直接忽略 `usage.cachedContentTokenCount`
   - 修复：提取后写入 `result.usage.cached_tokens` 和 `result.usage.prompt_tokens_details`

### 审计发现的 3 处遗漏（Patch 0002）

4. **`openAICompletionToClaudeMessage` 丢弃缓存字段**
   - 文件：`open-sse/handlers/chatCore/nonStreamingHandler.js` L57-61
   - 问题：OpenAI→Claude 非流式转换时 usage 只保留 `input_tokens`/`output_tokens`
   - 修复：从 `cached_tokens`/`prompt_tokens_details.cached_tokens` 提取后写入 `cache_read_input_tokens`

5. **`openAICompletionToResponses` 丢弃缓存字段**
   - 文件：`open-sse/handlers/chatCore/nonStreamingHandler.js` L133-138
   - 问题：OpenAI→Responses API 非流式转换完全无缓存字段
   - 修复：提取后写入 `input_tokens_details: { cached_tokens }`（Responses API 规范）

6. **Gemini 非流式 `thoughtsTokenCount` 归属不一致**
   - 文件：`open-sse/handlers/chatCore/nonStreamingHandler.js` L221
   - 问题：`thoughtsTokenCount` 被加到 `prompt_tokens`（膨胀输入），与 `extractUsage` 流式路径（归入 `completion_tokens`）不一致
   - 修复：移入 `completion_tokens`，对齐 `extractUsage` 和 `toOpenAIUsage` 的 Gemini 提取器

## 涉及文件

| 文件 | 变更类型 |
|------|---------|
| `open-sse/utils/usageTracking.js` | `filterUsageForFormat` 增加跨格式适配层 + `extractUsage` Gemini 补齐 `prompt_tokens_details` |
| `open-sse/handlers/chatCore/nonStreamingHandler.js` | 3 个函数的 usage 构建补齐缓存字段 + thinking 归属修正 |
| `tests/unit/cached-token-usage.test.js` | 新增 9 个测试（filterUsageForFormat 适配 + 非流式转换缓存透传） |
| `tests/unit/antigravity-nonstream-usage-3260.test.js` | 新增 Gemini 非流式 cached_tokens 保留测试 |

## Commits

```
0229f579 fix(usage): forward cache fields in OpenAI→Claude, OpenAI→Responses non-streaming paths + align Gemini thoughtsTokenCount
13b0eff3 fix(usage): bridge cached token fields across formats in filterUsageForFormat + extractUsage
```

## 上游合并注意事项

这两个 patch 基于 `e8b8f3fe`（upstream/master v0.5.55 sync）。上游更新后重新应用步骤：

```bash
cd /path/to/9router

# 1. 检查 patch 是否可以干净应用
git apply --check patches/0001-fix-usage-forward-cache-fields-in-OpenAI-Claude-Open.patch
git apply --check patches/0002-fix-usage-bridge-cached-token-fields-across-formats-.patch

# 2. 如果 check 通过，应用
git am patches/0001-fix-usage-forward-cache-fields-in-OpenAI-Claude-Open.patch
git am patches/0002-fix-usage-bridge-cached-token-fields-across-formats-.patch

# 3. 如果冲突，手动解决后
git am --continue

# 4. 跑测试验证
cd tests && rtk vitest unit/cached-token-usage.test.js unit/cached-token-e2e.test.js
```

## 关键审计结论

- **协议规范性**：✅ Anthropic `input_tokens` 排除缓存语义正确；OpenAI `prompt_tokens` 包含缓存语义正确
- **边界安全**：✅ `cached_tokens === 0/undefined` 不产生多余字段，`Math.max(0, ...)` 防御负数
- **副作用**：✅ 守卫条件确保仅在字段缺失时补齐，DeepSeek/OpenAI/Claude/Ollama 原生路径零影响
- **费用计算**：✅ `canonicalizeUsage` / `calculateCostFromTokens` 不受影响
- **测试**：24 项 unit + 5 项 e2e 全部通过，零回归
