# 组合(Combos)- 自定义回退链

创建自定义的模型组合并自动回退。组合让你根据成本、质量和可用性定义自己的路由策略。

---

## 什么是组合?

组合是你在仪表盘中创建的 **自定义回退链**。它不是单一模型,而是定义一组顺序模型,由 9Router 依次尝试。

**示例:**
```
组合名: premium-coding
模型:
  1. cc/claude-opus-4-5-20251101 (首选)
  2. glm/glm-4.7 (#1 配额耗尽时)
  3. minimax/MiniMax-M2.1 (#2 配额耗尽时)
```

**CLI 中使用:**
```
Model: premium-coding
```

9Router 会按顺序自动尝试每个模型,直到成功为止。

---

## 为什么使用组合?

### 1. 最大化订阅价值
```
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

→ 先用订阅,低价备用,免费应急
→ 充分利用你已付费的订阅
```

### 2. 最小化成本
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking

→ 从最便宜的付费选项开始(每 1M $0.60)
→ 回退到更便宜的(每 1M $0.20)
→ 应急免费层
→ 总成本: 约 $5-10/月,而 ChatGPT API 需要 $2000
```

### 3. 保障 24/7 可用
```
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7 → if/kimi-k2-thinking

→ 末尾总是放免费层
→ 永不耗尽配额
→ 随时随地编码
```

### 4. 质量优化
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → gc/gemini-3-pro

→ 优先最好的模型
→ 回退到其他高端模型
→ 整个回退链保持高质量
```

---

## 如何创建组合

### 步骤 1:打开仪表盘

```
http://localhost:20128
→ 用密码登录
```

### 步骤 2:进入组合页面

```
仪表盘 → 组合 → 新建组合
```

### 步骤 3:配置组合

**组合名:**
```
premium-coding
```

**描述(可选):**
```
订阅优先,低价备用,免费应急
```

**选择模型:**
```
1. cc/claude-opus-4-5-20251101
2. glm/glm-4.7
3. minimax/MiniMax-M2.1
```

**拖动排序** - 自上而下表示优先级。

### 步骤 4:保存

```
点击 "Save Combo"
→ 组合出现在模型列表中
```

### 步骤 5:在 CLI 中使用

```
Cursor/Cline/任意工具:
  Model: premium-coding
```

---

## 示例组合

### 示例 1:Premium Coding(订阅 → 低价 → 免费)

**目标**:最大化订阅价值,最小化额外成本。

```
仪表盘 → 组合 → 新建

名称: premium-coding
模型:
  1. cc/claude-opus-4-5-20251101
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

**用法:**
```
Cursor IDE:
  Model: premium-coding
```

**行为:**
```
早上(全新配额):
  请求 → cc/claude-opus-4-5 ✅

下午(Claude 配额用完):
  请求 → glm/glm-4.7 ✅ (自动切换)

晚上(GLM 配额用完):
  请求 → minimax/MiniMax-M2.1 ✅ (自动切换)
```

**月成本(100M tokens):**
```
80M 通过 Claude Code: $0(订阅)
15M 通过 GLM: $9
5M 通过 MiniMax: $1
合计: $10 + 你的订阅
```

**节省**:相比 ChatGPT API($2000)约 99%。

---

### 示例 2:Budget Combo(低价 → 免费)

**目标**:最小化成本,免费层作为备用。

```
仪表盘 → 组合 → 新建

名称: budget-combo
模型:
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/kimi-k2-thinking
```

**用法:**
```
Cline:
  Provider: OpenAI Compatible
  Base URL: http://localhost:20128/v1
  Model: budget-combo
```

**行为:**
```
请求 → glm/glm-4.7
  ✅ 每日配额可用 → 使用 GLM(每 1M $0.60)
  ❌ 配额耗尽 → 尝试 MiniMax(每 1M $0.20)
  ❌ MiniMax 配额用完 → 使用 iFlow(免费)
```

**月成本(100M tokens):**
```
70M 通过 GLM: $42
20M 通过 MiniMax: $4
10M 通过 iFlow: $0
合计: $46,而 ChatGPT API 需 $2000
```

**节省**:97%。

---

### 示例 3:Free Combo(零成本)

**目标**:100% 免费,永不付费。

```
仪表盘 → 组合 → 新建

名称: free-combo
模型:
  1. if/kimi-k2-thinking
  2. qw/qwen3-coder-plus
  3. kr/claude-sonnet-4.5
```

**用法:**
```
Claude Desktop:
  Model: free-combo
```

**行为:**
```
请求 → if/kimi-k2-thinking
  ✅ 可用 → 使用 iFlow
  ❌ 错误 → 尝试 Qwen
  ❌ 错误 → 尝试 Kiro
```

**月成本:**
```
100M tokens 通过免费提供商: $0
合计: 永远 $0
```

**适用场景**:个人项目、学习、试验。

---

### 示例 4:Quality First(仅高端模型)

**目标**:最高质量,无低价回退。

```
仪表盘 → 组合 → 新建

名称: quality-first
模型:
  1. cc/claude-opus-4-5-20251101
  2. cx/gpt-5.2-codex
  3. gc/gemini-3-pro-preview
```

**用法:**
```
Codex CLI:
  export OPENAI_BASE_URL="http://localhost:20128"
  Model: quality-first
```

**行为:**
```
请求 → cc/claude-opus-4-5
  ❌ 配额用完 → cx/gpt-5.2-codex
  ❌ 配额用完 → gc/gemini-3-pro-preview
  ❌ 全部用完 → 返回错误(无低价回退)
```

**适用场景**:关键生产代码、复杂重构。

---

### 示例 5:Multi-Subscription(用足所有订阅)

**目标**:在产生额外费用前用足所有订阅。

```
仪表盘 → 组合 → 新建

名称: multi-sub
模型:
  1. gc/gemini-3-flash-preview (每月免费 180K)
  2. cc/claude-opus-4-5-20251101 (Pro 订阅)
  3. cx/gpt-5.2-codex (Plus 订阅)
  4. gh/gpt-5 (Copilot 订阅)
  5. glm/glm-4.7 (低价备用)
  6. if/kimi-k2-thinking (免费应急)
```

**月成本(200M tokens):**
```
50M 通过 Gemini CLI: $0(免费层)
80M 通过 Claude Code: $0(订阅)
40M 通过 Codex: $0(订阅)
20M 通过 Copilot: $0(订阅)
8M 通过 GLM: $4.80
2M 通过 iFlow: $0
合计: $4.80 + 你已有的订阅
```

**结果**:190M tokens 来自订阅,只有 $4.80 额外费用。

---

### 示例 6:配额重置优化

**目标**:根据重置时间分配使用。

```
仪表盘 → 组合 → 新建

名称: reset-optimized
模型:
  1. cc/claude-opus-4-5 (5h 重置, 早上用)
  2. gc/gemini-3-flash (每日 1K, 下午用)
  3. glm/glm-4.7 (每日 10AM 重置, 晚上用)
  4. minimax/MiniMax-M2.1 (5h 滚动, 夜里用)
  5. if/kimi-k2-thinking (无限, 应急)
```

**日常安排:**
```
08:00 - 13:00: Claude Code(全新 5h 配额)
13:00 - 18:00: Gemini CLI(每日 1K 配额)
18:00 - 22:00: GLM(次日 10AM 重置)
22:00 - 08:00: MiniMax(5h 滚动)或 iFlow
```

**结果**:24/7 编码,成本极低。

---

## 在 CLI 工具中使用组合

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [从仪表盘获取]
  Model: premium-coding
```

### Claude Desktop

编辑 `~/.claude/config.json`:
```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key",
  "model": "budget-combo"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex --model quality-first "your prompt"
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [从仪表盘获取]
Model: free-combo
```

### API 请求

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [
      {"role": "user", "content": "Write a function to..."}
    ],
    "stream": true
  }'
```

---

## 最佳实践

### 1. 总是包含免费层

```
✅ 好:
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

❌ 不好:
cc/claude-opus → glm/glm-4.7
(无免费回退,可能耗尽配额)
```

**原因**:确保 24/7 可用,绝不会被配额卡住。

### 2. 按成本排序(便宜 → 贵)

```
✅ 好:
glm/glm-4.7 → minimax/MiniMax-M2.1 → cc/claude-opus

❌ 不好:
cc/claude-opus → glm/glm-4.7
(在简单任务上浪费订阅配额)
```

**例外**:如果想充分利用订阅价值,把订阅放在最前面。

### 3. 匹配质量要求

```
生产代码:
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7

简单任务:
glm/glm-4.7 → if/kimi-k2-thinking

试验:
if/kimi-k2-thinking → qw/qwen3-coder-plus
```

### 4. 考虑配额重置时间

```
早上组合(配额刚刷新):
cc/claude-opus → cx/gpt-5.2-codex

晚上组合(配额大概率耗尽):
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

### 5. 为不同场景创建多个组合

```
premium-coding: 复杂任务
budget-combo: 简单任务
free-combo: 试验
quality-first: 生产代码
```

**根据任务需求切换组合**。

### 6. 监控组合性能

```
仪表盘 → 分析 → 组合使用:
  premium-coding:
    80% 通过 cc/claude-opus(良好,使用订阅)
    15% 通过 glm/glm-4.7(可接受备用)
    5% 通过 minimax(罕见回退)
```

**优化**:回退使用过多时,提高主配额或重新排序模型。

---

## 高级配置

### 为组合设置预算上限

```
仪表盘 → 组合 → 编辑 → 预算:
  每日上限: $5
  每月上限: $50
```

达到上限时,9Router 跳过付费模型,仅使用免费层。

### 启用/禁用组合中的模型

```
仪表盘 → 组合 → 编辑 → 模型:
  ✅ cc/claude-opus-4-5(启用)
  ❌ glm/glm-4.7(暂时禁用)
  ✅ if/kimi-k2-thinking(启用)
```

**用途**:暂时禁用昂贵模型而不删除组合。

### 克隆已有组合

```
仪表盘 → 组合 → 克隆 "premium-coding"
→ 生成带 "-copy" 后缀的副本
→ 修改后另存为新组合
```

**用途**:为不同场景创建变体。

---

## 故障排除

**问题:组合未出现在模型列表中**

**方案:**
1. 刷新仪表盘
2. 检查组合已保存(绿色对勾)
3. 重启 CLI 工具以刷新模型列表

**问题:组合总是用最后一个模型(免费层)**

**方案:**
1. 检查主模型的配额(仪表盘 → 配额)
2. 确认 API keys 有效(仪表盘 → 提供商)
3. 检查是否超出预算上限

**问题:组合成本超出预期**

**方案:**
1. 仪表盘 → 分析 → 查看组合使用情况
2. 检查主模型是否配额耗尽
3. 重新排序模型(更便宜的放前面)
4. 设置预算上限

---

## 相关

- [智能路由](./smart-routing.md) - 自动回退如何工作
- [配额跟踪](./quota-tracking.md) - 监控使用与成本
