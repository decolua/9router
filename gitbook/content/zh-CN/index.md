# 欢迎使用 9Router

**免费使用 Claude、Codex、Gemini • 超低价替代方案,每 1M token 仅需 $0.20**

9Router 是一款 AI 模型路由工具,通过智能路由和自动回退机制,最大化你的订阅价值并最小化成本。

---

## 什么是 9Router?

9Router 是一款智能代理,位于你的编码工具(Cursor、Cline、Claude Desktop)与 AI 提供商之间。它会根据配额、成本和可用性,自动将请求路由到最合适的模型。

**告别浪费:**
- ❌ 订阅配额每月未用完就过期
- ❌ 速率限制让你写代码写到一半被卡住
- ❌ 昂贵的 API(每个提供商每月 $20-50)
- ❌ 在不同提供商之间手动切换

**开始最大化价值:**
- ✅ **充分利用订阅** - 跟踪并用完 Claude Code、Codex、Gemini 的每一点配额
- ✅ **免费可用** - 通过 CLI 访问 iFlow、Qwen、Kiro 模型
- ✅ **超低价备用** - GLM(每 1M $0.6)、MiniMax M2.1(每 1M $0.20)
- ✅ **智能回退** - 订阅 → 低价 → 免费,自动切换

---

## 核心特性

### 🔄 智能三层回退

```
一次配置,永不停码:

第 1 层(订阅): Claude Code → Codex → Gemini
  ↓ 配额耗尽
第 2 层(低价): GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ 预算上限
第 3 层(免费): iFlow → Qwen → Kiro

→ 自动切换,零停机!
```

### 📊 配额跟踪

- 每个提供商的实时 token 消耗
- 重置倒计时(5 小时、每日、每周、每月)
- 付费层级的成本估算
- 每月支出报告

### 🎯 通用 CLI 支持

适用于所有支持自定义 OpenAI endpoint 的工具:

✅ **Cursor** • **Cline** • **Claude Desktop** • **Codex** • **RooCode** • **Continue** • **任何 OpenAI 兼容工具**

### 💰 成本优化

**真实案例(每月 100M tokens):**
```
60M 通过 Gemini CLI: $0(免费层)
30M 通过 Claude Code: $0(你已有的订阅)
8M 通过 GLM: $4.80
2M 通过 MiniMax: $0.40
合计: $5.20/月,而 ChatGPT API 需要 $2000!
```

---

## 为什么选择 9Router?

### 最大化订阅价值

已经在为 Claude Code(每月 $20-100)或 Codex(每月 $20-200)付费?那就用足它:

- 实时跟踪配额使用
- 配额重置时(5 小时、每周)自动切换
- 在过期前用掉每一个 token
- Gemini CLI:每月 180K 次补全 **免费**

### 超低价备用

订阅配额用完时,只需花几分钱:

| 提供商 | 每 1M tokens 成本 | 重置时间 |
|----------|-------------------|-------|
| **GLM-4.7** | 输入 $0.60 / 输出 $2.20 | 每日 10:00 AM |
| **MiniMax M2.1** | 输入 $0.20 / 输出 $1.00 | 5 小时滚动 |
| **Kimi K2** | $9/月(10M tokens) | 每月 |

**比 ChatGPT API(每 1M $20)便宜约 90%!**

### 永久免费回退

当其他一切都受配额限制时的应急备用:

- **iFlow**:8 个模型(Kimi K2、Qwen3 Coder Plus、GLM 4.7、MiniMax M2)
- **Qwen**:3 个模型(Qwen3 Coder Plus/Flash、Vision)
- **Kiro**:Claude Sonnet 4.5、Haiku 4.5(AWS Builder ID)

---

## 快速开始

2 分钟即可上手:

```bash
# 全局安装
npm install -g 9router

# 启动(仪表盘自动打开)
9router
```

🎉 **仪表盘自动打开** → 连接提供商 → 开始编码!

**在你的 CLI 工具中使用:**

```
Endpoint: http://localhost:20128/v1
API Key: [从仪表盘获取]
Model: cc/claude-opus-4-5-20251101
```

[→ 完整入门指南](getting-started.md)

---

## 使用场景

### 个人开发者

- 最大化你的 Claude Code/Codex 订阅
- 使用 Gemini CLI 免费层(每月 180K)
- 回退到超低价模型(每 1M $0.20)
- 24/7 编码不受速率限制

### 团队

- 部署在 VPS/云服务器上共享访问
- 实时跟踪团队支出
- 为每层设置预算上限
- 集中管理提供商

### 移动/远程编码

- 使用云端部署(https://9router.com)
- 从 iPad、手机、任何地方访问
- 没有 localhost 限制
- Cloudflare 边缘网络(300+ 节点)

---

## 接下来做什么?

- [入门指南](getting-started.md) - 5 分钟内完成安装和配置
- [安装指南](getting-started/installation.md) - 详细的设置说明
- [功能特性](features/) - 探索所有能力
- [常见问题](faq.md) - 常见问题解答

---

<div align="center">
  <sub>用 ❤️ 为最大化 AI 价值的开发者打造</sub>
</div>
