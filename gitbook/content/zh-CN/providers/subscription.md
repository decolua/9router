# 订阅型提供商 - 最大化你的价值

通过智能配额跟踪和自动回退,最大化你已有的 AI 订阅价值。在重置前用完每一点订阅配额!

---

## 概览

订阅型提供商是你的 **首选** - 既然已经付费了,就要用足:

- ✅ **Claude Code**(Pro/Max)- Claude 4.5 Opus/Sonnet/Haiku
- ✅ **OpenAI Codex**(Plus/Pro)- GPT 5.2 Codex、GPT 5.1 Codex Max
- ✅ **Gemini CLI**(免费层!)- 每月 180K 次补全
- ✅ **GitHub Copilot** - GPT-5、Claude 4.5、Gemini 3
- ✅ **Antigravity**(Google)- Gemini 3 Pro、Claude Sonnet 4.5

**策略:** 优先使用这些,实时跟踪配额,耗尽时回退到低价/免费层。

---

## Claude Code(Pro/Max)

### 价格

| 套餐 | 月费 | 配额重置 | 模型 |
|------|--------------|-------------|--------|
| Pro | $20 | 5 小时 + 每周 | Opus、Sonnet、Haiku |
| Max | $100 | 5 小时 + 每周 | Opus、Sonnet、Haiku |

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘打开 → 提供商 → 连接 Claude Code
```

**步骤 2:OAuth 登录**

- 点击 "Connect Claude Code"
- 浏览器打开 → 登录 Claude.ai
- 启用自动 token 刷新
- 开始配额跟踪

**步骤 3:在 CLI 中使用**

```
Model: cc/claude-opus-4-5-20251101
       cc/claude-sonnet-4-5-20250929
       cc/claude-haiku-4-5-20251001
```

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `cc/claude-opus-4-5-20251101` | Claude 4.5 Opus | 复杂任务、架构 |
| `cc/claude-sonnet-4-5-20250929` | Claude 4.5 Sonnet | 平衡速度/质量 |
| `cc/claude-haiku-4-5-20251001` | Claude 4.5 Haiku | 快速响应 |

### 专业建议

- **Opus 用于复杂任务** - 架构决策、重构
- **Sonnet 用于速度** - 快速编辑、代码生成
- **按模型跟踪配额** - 仪表盘按模型显示使用情况
- **5 小时重置** - 每 5 小时刷新配额,加每周重置

---

## OpenAI Codex(Plus/Pro)

### 价格

| 套餐 | 月费 | 配额重置 | 模型 |
|------|--------------|-------------|--------|
| Plus | $20 | 5 小时 + 每周 | GPT 5.2、GPT 5.1 |
| Pro | $200 | 5 小时 + 每周 | GPT 5.2 Codex、GPT 5.1 Max |

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘 → 提供商 → 连接 Codex
```

**步骤 2:OAuth 登录**

- 点击 "Connect Codex"
- 浏览器打开 `http://localhost:1455`
- 登录 OpenAI 账户
- 启用自动 token 刷新

**步骤 3:在 CLI 中使用**

```
Model: cx/gpt-5.2-codex
       cx/gpt-5.1-codex-max
       cx/gpt-5.2
       cx/gpt-5.1-codex
```

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `cx/gpt-5.2-codex` | GPT 5.2 Codex | 最新编码模型 |
| `cx/gpt-5.1-codex-max` | GPT 5.1 Codex Max | 最大上下文 |
| `cx/gpt-5.2` | GPT 5.2 | 通用任务 |
| `cx/gpt-5.1-codex` | GPT 5.1 Codex | 稳定编码 |

### 专业建议

- **5 小时滚动配额** - 每 5 小时刷新配额
- **每周重置** - 每周配额完全重置
- **Pro 层** - 配额是 Plus 的 10 倍

---

## Gemini CLI(每月免费 180K!)

### 价格

| 套餐 | 月费 | 配额 | 重置 |
|------|--------------|-------|-------|
| 免费 | $0 | 180K 次补全/月 + 每日 1K | 每日 + 每月 |

**最佳性价比:** 巨大的免费层!请在付费层之前使用。

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘 → 提供商 → 连接 Gemini CLI
```

**步骤 2:Google OAuth**

- 点击 "Connect Gemini CLI"
- 浏览器打开 → 登录 Google 账户
- 授予权限
- 启用自动 token 刷新

**步骤 3:在 CLI 中使用**

```
Model: gc/gemini-3-flash-preview
       gc/gemini-3-pro-preview
       gc/gemini-2.5-pro
       gc/gemini-2.5-flash
```

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `gc/gemini-3-flash-preview` | Gemini 3 Flash Preview | 快速响应 |
| `gc/gemini-3-pro-preview` | Gemini 3 Pro Preview | 复杂任务 |
| `gc/gemini-2.5-pro` | Gemini 2.5 Pro | 稳定生产 |
| `gc/gemini-2.5-flash` | Gemini 2.5 Flash | 快速任务 |

### 专业建议

- **每月 180K 次补全** - 大量免费层
- **每日 1K 限制** - 每天午夜重置
- **优先使用** - 免费层,先于付费订阅
- **无需信用卡** - Google 账户完全免费

---

## GitHub Copilot

### 价格

| 套餐 | 月费 | 配额重置 | 模型 |
|------|--------------|-------------|--------|
| 个人 | $10 | 每月(1 日) | GPT-5、Claude 4.5、Gemini 3 |
| 商业 | $19 | 每月(1 日) | GPT-5、Claude 4.5、Gemini 3 |

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘 → 提供商 → 连接 GitHub
```

**步骤 2:通过 GitHub 进行 OAuth**

- 点击 "Connect GitHub"
- 浏览器打开 → 登录 GitHub
- 授权 GitHub Copilot
- 启用自动 token 刷新

**步骤 3:在 CLI 中使用**

```
Model: gh/gpt-5
       gh/gpt-5.1-codex-max
       gh/claude-4.5-sonnet
       gh/gemini-3-pro
```

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `gh/gpt-5` | GPT-5 | 最新 OpenAI 模型 |
| `gh/gpt-5.1-codex-max` | GPT-5.1 Codex Max | 最大上下文 |
| `gh/claude-4.5-sonnet` | Claude 4.5 Sonnet | Anthropic 质量 |
| `gh/gemini-3-pro` | Gemini 3 Pro | Google 质量 |

### 专业建议

- **每月重置** - 每月 1 日完全重置
- **多模型** - 一个订阅访问 GPT、Claude、Gemini
- **商业层** - 团队更高配额

---

## Antigravity(Google 账户)

### 价格

| 套餐 | 月费 | 配额 | 模型 |
|------|--------------|-------|--------|
| 免费 | $0 | 类似 Gemini CLI | Gemini 3 Pro、Claude Sonnet 4.5 |

### 设置

**步骤 1:通过仪表盘连接**

```bash
9router
# 仪表盘 → 提供商 → 连接 Antigravity
```

**步骤 2:Google OAuth**

- 点击 "Connect Antigravity"
- 浏览器打开 → 登录 Google 账户
- 授予权限
- 启用自动 token 刷新

**步骤 3:在 CLI 中使用**

```
Model: ag/gemini-3-pro-high
       ag/claude-sonnet-4-5
       ag/claude-opus-4-5-thinking
```

### 可用模型

| 模型 ID | 描述 | 最佳场景 |
|----------|-------------|----------|
| `ag/gemini-3-pro-high` | Gemini 3 Pro High | 高质量响应 |
| `ag/claude-sonnet-4-5` | Claude Sonnet 4.5 | Anthropic 质量 |
| `ag/claude-opus-4-5-thinking` | Claude Opus 4.5 Thinking | 复杂推理 |

### 专业建议

- **免费层** - Google 账户零成本
- **可访问 Claude** - 免费的 Claude Sonnet/Opus
- **配额类似 Gemini CLI** - 每日/每月上限

---

## 价格对比

| 提供商 | 月费 | 配额重置 | 价值 |
|----------|--------------|-------------|-------|
| **Claude Code Pro** | $20 | 5 小时 + 每周 | ⭐⭐⭐⭐⭐ 最佳质量 |
| **Claude Code Max** | $100 | 5 小时 + 每周 | ⭐⭐⭐⭐⭐ 最高配额 |
| **Codex Plus** | $20 | 5 小时 + 每周 | ⭐⭐⭐⭐ 良好性价比 |
| **Codex Pro** | $200 | 5 小时 + 每周 | ⭐⭐⭐⭐⭐ 10× 配额 |
| **Gemini CLI** | **$0** | 每日 + 每月 | ⭐⭐⭐⭐⭐ 免费 180K/月! |
| **GitHub Copilot** | $10-19 | 每月(1 日) | ⭐⭐⭐⭐ 多模型 |
| **Antigravity** | **$0** | 每日 + 每月 | ⭐⭐⭐⭐ 免费 Claude! |

---

## 使用示例

### Cursor IDE 设置

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [从 9router 仪表盘获取]
  Model: cc/claude-opus-4-5-20251101
```

### 创建组合(推荐)

```
仪表盘 → 组合 → 新建

名称: premium-coding
模型:
  1. gc/gemini-3-flash-preview (免费, 优先使用)
  2. cc/claude-opus-4-5-20251101 (订阅)
  3. cx/gpt-5.2-codex (订阅备用)

CLI 中使用: premium-coding
```

**结果:** 最大化免费层 → 使用订阅 → 自动回退

---

## 配额跟踪

9Router 实时跟踪配额:

- **Token 消耗** - 每次请求的输入/输出 tokens
- **重置倒计时** - 下次配额重置剩余时间
- **使用百分比** - 配额已用比例
- **自动回退** - 耗尽时切换到下一层

**仪表盘视图:**

```
Claude Code Pro
├─ 配额: 已用 75%
├─ 重置: 2h 15m(5 小时)
├─ 每周重置: 3 天
└─ 回退: glm/glm-4.7(低价层)
```

---

## 最佳实践

### 1. 优先使用免费层

```
优先级:
1. Gemini CLI(每月免费 180K)
2. Antigravity(免费 Claude)
3. Claude Code/Codex(付费订阅)
```

### 2. 每日跟踪配额

- 每天早上查看仪表盘
- 围绕配额重置规划重任务
- 非关键任务用低价/免费层

### 3. 创建智能组合

```
示例组合:
1. gc/gemini-3-flash-preview(免费主力)
2. cc/claude-opus-4-5(复杂任务)
3. glm/glm-4.7(低价备用)
4. if/kimi-k2-thinking(免费回退)
```

### 4. 按时间优化

```
早上: 全新 5 小时配额(Claude/Codex)
下午: Gemini CLI(每日 1K)
晚上: 订阅配额
深夜: 低价/免费层
```

---

## 故障排除

### "Quota exhausted"

**方案:**
- 查看仪表盘配额跟踪
- 等待重置(5 小时或每日)
- 使用组合回退到低价/免费层

### "OAuth token expired"

**方案:**
- 9Router 会自动刷新
- 若仍有问题: 仪表盘 → 提供商 → 重新连接

### "Rate limiting"

**方案:**
- 订阅配额已用尽
- 添加回退:`cc/claude-opus → glm/glm-4.7`
- 使用免费层:`if/kimi-k2-thinking`

---

## 下一步

- **设置低价备用:** [低价提供商](./cheap.md)
- **添加免费回退:** [免费提供商](./free.md)
- **创建组合:** 仪表盘 → 组合 → 新建
