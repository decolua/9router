
<div align="center">
  <img src="./images/9router.png?1" alt="9Router Dashboard" width="800"/>
  
  # 9Router - 免费 AI 路由器与 Token 节省器
  
  **编程永不停歇。使用 RTK + 自动切换到免费/低价 AI 模型，节省 20-40% 的 tokens。**
  
  **将所有 AI 编程工具（Claude Code、Cursor、Antigravity、Copilot、Codex、Gemini、OpenCode、Cline、OpenClaw...）连接到 40+ AI 提供商和 100+ 模型。**
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

  <a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
  
  [🚀 快速开始](#-快速开始) • [💡 功能特点](#-主要功能) • [📖 设置指南](#-设置指南) • [🌐 网站](https://9router.com)

  [🇻🇳 Tiếng Việt](./i18n/README.vi.md) • [🇨🇳 中文](./i18n/README.zh-CN.md) • [🇯🇵 日本語](./i18n/README.ja-JP.md)
</div>

---

## 🤔 为什么选择 9Router？

**告别浪费金钱、tokens 和触碰限制的困扰：**

- ❌ 订阅配额每月到期却未使用
- ❌ 速率限制在编程中途打断你
- ❌ 工具输出（git diff、grep、ls...）快速消耗 tokens
- ❌ 昂贵的 API（每个提供商 $20-50/月）
- ❌ 需要手动在提供商之间切换

**9Router 解决这一切：**

- ✅ **RTK Token 节省器** - 自动压缩 tool_result 内容，每次请求节省 20-40% tokens
- ✅ **充分利用订阅** - 追踪配额，在重置前用尽每一分额度
- ✅ **自动切换** - 订阅 → 低价 → 免费，零停机时间
- ✅ **多账户支持** - 按提供商在账户之间轮询
- ✅ **通用兼容** - 支持 Claude Code、Codex、Cursor、Cline 以及任何 CLI 工具

---

## 🔄 工作原理

```
┌─────────────┐
│  你的 CLI   │  (Claude Code、Codex、OpenClaw、Cursor、Cline...)
│   工具      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           9Router（智能路由器）              │
│  • RTK Token 节省器（减少 tool_result tokens）│
│  • 格式转换（OpenAI ↔ Claude）              │
│  • 配额追踪                                  │
│  • 自动刷新 token                           │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [第一层：订阅] Claude Code、Codex、GitHub Copilot
       │   ↓ 配额耗尽
       ├─→ [第二层：低价] GLM ($0.6/1M)、MiniMax ($0.2/1M)
       │   ↓ 预算超限
       └─→ [第三层：免费] Kiro、OpenCode Free、Vertex ($300 额度)

结果：编程永不停歇，最小成本 + 通过 RTK 节省 20-40% tokens
```

---

## ⚡ 快速开始

**1. 全局安装：**

```bash
npm install -g 9router
9router
```

🎉 控制面板在 `http://localhost:20128` 打开

**2. 连接免费提供商（无需注册）：**

控制面板 → 提供商 → 连接 **Kiro AI**（免费 Claude 无限量）或 **OpenCode Free**（无需认证）→ 完成！

**3. 在 CLI 工具中使用：**

```
Claude Code/Codex/OpenClaw/Cursor/Cline 设置：
  Endpoint: http://localhost:20128/v1
  API Key: [从控制面板复制]
  Model: kr/claude-sonnet-4.5
```

**就这么简单！** 开始使用免费 AI 模型编程。

**替代方案：从源码运行（本仓库）：**

本仓库的包是私有的（`9router-app`），所以源码/Docker 执行是预期的本地开发方式。

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

生产模式：

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

默认 URL：
- 控制面板：`http://localhost:20128/dashboard`
- OpenAI 兼容 API：`http://localhost:20128/v1`

---

## 视频教程

<div align="center">

<table>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=raEyZPg5xE0">
        <img src="https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code 免费设置<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=X69n5Lm06Yw">
        <img src="https://img.youtube.com/vi/X69n5Lm06Yw/maxresdefault.jpg" alt="Tiết kiệm chi phí LLM với 9Router" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>使用 9Router 节省 OpenClaw 的 LLM 成本<br/>by <a href="https://www.youtube.com/c/M%C3%ACAIblog">Mì AI</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=o3qYCyjrFYg">
        <img src="https://img.youtube.com/vi/o3qYCyjrFYg/maxresdefault.jpg" alt="Claude Code FREE Forever" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude Code 免费永久使用 — 无限模型<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=Ttpc26m39Dw">
        <img src="https://img.youtube.com/vi/Ttpc26m39Dw/maxresdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>使用 9Router 免费设置 Claude CLI 🚀<br/>by <a href="https://www.youtube.com/@CodeVerseSoban">CodeVerse Soban</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=G-5A_D5Pm6Y">
        <img src="https://img.youtube.com/vi/G-5A_D5Pm6Y/maxresdefault.jpg" alt="Cài đặt OpenClaw Free A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>从零开始安装 OpenClaw 免费版 + 9Router<br/>by <a href="https://www.youtube.com/@maigia">Mai Gia</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=JXmg8_gccgE">
        <img src="https://img.youtube.com/vi/JXmg8_gccgE/maxresdefault.jpg" alt="FREE OpenClaw with Claude Opus" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>免费 OpenClaw + Claude Opus 4.6<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
  </tr>
</table>

</div>

> 🎬 **制作了关于 9Router 的视频？** 提交 [Pull Request](https://github.com/decolua/9router/pulls)，将你的视频添加到此部分 — 我们会合并它！

---

## 🛠️ 支持的 CLI 工具

9Router 与所有主流 AI 编程工具无缝协作：

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 支持的提供商

### 🔐 OAuth 提供商

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 免费提供商

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="./public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax<br/>无限免费</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/opencode.png" width="70" alt="OpenCode Free"/><br/>
        <b>OpenCode Free</b><br/>
        <sub>无需认证 • 自动获取模型<br/>无限免费</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek<br/>$300 免费额度</sub>
      </td>
    </tr>
  </table>
</div>

> **注意：** iFlow、Qwen 和 Gemini CLI 的免费等级已于 2026 年停止。请改用 Kiro / OpenCode Free / Vertex。

### 🔑 API Key 提供商（40+）

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...以及 20+ 更多提供商，包括 Nebius、Chutes、Hyperbolic 和自定义 OpenAI/Anthropic 兼容端点</i></p>
</div>

---

## 💡 主要功能

| 功能 | 作用 | 为什么重要 |
|---------|--------------|----------------|
| 🚀 **RTK Token 节省器**（[RTK](https://github.com/rtk-ai/rtk) ⭐40K） | 压缩工具输出（`git diff`、`grep`、`ls`、`tree`...）后再发送给 LLM | 每次请求节省 **20-40% 输入 tokens** |
| 🪨 **Caveman 模式**（[Caveman](https://github.com/JuliusBrussee/caveman) ⭐52K） | 注入 caveman 风格提示词 → LLM 回复简洁，保留技术实质 | 节省 **高达 65% 输出 tokens** |
| 🎯 **智能三层切换** | 自动路由：订阅 → 低价 → 免费 | 编程永不停歇，零停机时间 |
| 📊 **实时配额追踪** | 实时 token 计数 + 重置倒计时 | 充分利用订阅价值 |
| 🔄 **格式转换** | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex | 兼容任何 CLI 工具 |
| 👥 **多账户支持** | 每个提供商支持多个账户 | 负载均衡 + 冗余备份 |
| 🔄 **自动 Token 刷新** | OAuth token 自动刷新 | 无需手动重新登录 |
| 🎨 **自定义组合** | 创建无限模型组合 | 自定义适合你的切换策略 |
| 📝 **请求日志** | 调试模式下的完整请求/响应日志 | 轻松排查问题 |
| 💾 **云同步** | 跨设备同步配置 | 处处相同设置 |
| 📊 **使用分析** | 追踪 tokens、成本、趋势 | 优化开支 |
| 🌐 **任意部署** | 本地、VPS、Docker、Cloudflare Workers | 灵活部署选项 |

<details>
<summary><b>📖 功能详情</b></summary>

### 🚀 RTK Token 节省器

工具输出（`git diff`、`grep`、`find`、`ls`、`tree`、日志转储...）通常占用 30-50% 的提示词预算。RTK 在请求到达 LLM 之前检测并应用智能、无损压缩：

- **过滤器：** `git-diff`、`git-status`、`grep`、`find`、`ls`、`tree`、`dedup-log`、`smart-truncate`、`read-numbered`、`search-list`
- **自动检测：** 无需配置 — RTK 检查每个 `tool_result` 的前 1KB，选择合适的过滤器。
- **安全设计：** 如果过滤器失败、抛出异常或使输出变大，RTK 会静默保留原始文本。错误永远不会中断你的请求。
- **通用兼容：** 适用于所有格式（OpenAI、Claude、Gemini、Cursor、Kiro、OpenAI Responses），因为它在任何格式转换**之前**运行。
- **默认开启：** 可随时在控制面板 → 端点设置中切换。

```
不使用 RTK：47K tokens 发送给 LLM
使用 RTK：    28K tokens 发送给 LLM   (节省 40% · 相同上下文 · 相同答案)
```

### 🎯 智能三层切换

创建具有自动切换功能的组合：

```
组合："my-coding-stack"
  1. cc/claude-opus-4-6        （你的订阅）
  2. glm/glm-4.7               （低价备份，$0.6/1M）
  3. if/kimi-k2-thinking       （免费备选）

→ 配额用完或出错时自动切换
```

### 📊 实时配额追踪

- 每个提供商的 token 消耗
- 重置倒计时（5小时、每日、每周）
- 付费等级的成本估算
- 月度支出报告

### 🔄 格式转换

格式间无缝转换：
- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- 你的 CLI 工具发送 OpenAI 格式 → 9Router 转换 → 提供商接收原生格式
- 适用于任何支持自定义 OpenAI 端点的工具

### 👥 多账户支持

- 每个提供商添加多个账户
- 自动轮询或基于优先级的路由
- 当一个账户达到配额时切换到下一个

### 🔄 自动 Token 刷新

- OAuth token 在过期前自动刷新
- 无需手动重新认证
- 所有提供商的无缝体验

### 🎨 自定义组合

- 创建无限模型组合
- 混合订阅、低价和免费等级
- 为组合命名以便访问
- 使用云同步跨设备共享组合

### 📝 请求日志

- 启用调试模式获取完整请求/响应日志
- 追踪 API 调用、请求头和载荷
- 排查集成问题
- 导出日志进行分析

### 💾 云同步

- 跨设备同步提供商、组合和设置
- 自动后台同步
- 安全加密存储
- 从任何地方访问你的设置

#### 云运行时说明

- 生产环境中优先使用服务端云变量：
  - `BASE_URL`（云同步调度程序使用的内部回调 URL）
  - `CLOUD_URL`（云同步端点基础 URL）
- `NEXT_PUBLIC_BASE_URL` 和 `NEXT_PUBLIC_CLOUD_URL` 仍用于兼容性/UI，但服务端运行时现在优先使用 `BASE_URL`/`CLOUD_URL`。
- 云同步请求现在使用超时 + 快速失败行为，以避免云 DNS/网络不可用时 UI 挂起。

### 📊 使用分析

- 追踪每个提供商和模型的 token 使用量
- 成本估算和支出趋势
- 月度报告和洞察
- 优化你的 AI 支出

> **💡 重要 - 了解控制面板成本：**
> 
> 使用分析中显示的"成本"**仅用于追踪和比较目的**。
> 9Router 本身**永远不会向你收费**。你只直接向提供商付款（如果使用付费服务）。
> 
> **示例：** 如果你的控制面板显示使用 iFlow 模型时"总成本 $290"，这代表你如果直接使用付费 API 需要支付的金额。你的实际成本 = **$0**（iFlow 免费无限量）。
> 
> 把它想象成一个"节省追踪器"，展示你通过使用免费模型或通过 9Router 路由节省了多少钱！

### 🌐 任意部署

- 💻 **本地** - 默认，离线可用
- ☁️ **VPS/云** - 跨设备共享
- 🐳 **Docker** - 一键部署
- 🚀 **Cloudflare Workers** - 全球边缘网络

</details>

---

## 💰 价格一览

| 等级 | 提供商 | 成本 | 配额重置 | 适用场景 |
|------|----------|------|-------------|----------|
| **🚀 TOKEN 节省器** | **RTK（内置）** | **免费** | 始终开启 | **每次请求节省 20-40% tokens** |
| **💳 订阅** | Claude Code (Pro/Max) | $20-200/月 | 5小时 + 每周 | 已有订阅的用户 |
| | Codex (Plus/Pro) | $20-200/月 | 5小时 + 每周 | OpenAI 用户 |
| | GitHub Copilot | $10-19/月 | 每月 | GitHub 用户 |
| | Cursor IDE | $20/月 | 每月 | Cursor 用户 |
| **💰 低价** | GLM-5.1 / GLM-4.7 | $0.6/1M | 每日 10AM | 预算备份 |
| | MiniMax M2.7 | $0.2/1M | 5小时滚动 | 最便宜选项 |
| | Kimi K2.5 | $9/月固定 | 10M tokens/月 | 可预测成本 |
| **🆓 免费** | Kiro AI | $0 | 无限量 | Claude 4.5 + GLM-5 + MiniMax 免费 |
| | OpenCode Free | $0 | 无限量 | 无需认证，自动获取模型 |
| | Vertex AI | $300 额度 | 新 GCP 账户 | Gemini 3 Pro + DeepSeek + GLM-5 |

**💡 专业提示：** RTK + Kiro AI + OpenCode Free 组合 = **$0 成本 + 节省 20-40% tokens**！

---

### 📊 理解 9Router 成本与计费

**9Router 计费真相：**

✅ **9Router 软件 = 永久免费**（开源，绝不收费）  
✅ **控制面板"成本" = 仅用于显示/追踪**（不是实际账单）  
✅ **你直接向提供商付款**（订阅或 API 费用）  
✅ **免费提供商保持免费**（iFlow、Kiro、Qwen = $0 无限量）  
❌ **9Router 永不发送发票** 或扣款

**成本显示如何工作：**

控制面板显示**估算成本**，如同你直接使用付费 API。这**不是计费** — 它是一个比较工具，展示你的节省。

**示例场景：**
```
控制面板显示：
• 总请求数：1,662
• 总 Tokens：47M
• 显示成本：$290

实际检查：
• 提供商：iFlow（免费无限量）
• 实际支付：$0.00
• $290 意味着什么：通过使用免费模型节省的金额！
```

**付款规则：**
- **订阅提供商**（Claude Code、Codex）：通过他们的网站直接付款
- **低价提供商**（GLM、MiniMax）：直接付款，9Router 只做路由
- **免费提供商**（iFlow、Kiro、Qwen）：真正的永久免费，无隐藏费用
- **9Router**：从不收取任何费用，永远不会

---

## 🎯 使用场景

### 场景 1："我有 Claude Pro 订阅"

**问题：** 配额到期未用完，繁忙编码时遇到速率限制

**解决方案：**
```
组合："maximize-claude"
  1. cc/claude-opus-4-7        （充分利用订阅）
  2. glm/glm-5.1               （配额用完时的低价备份）
  3. kr/claude-sonnet-4.5      （免费紧急备选）

月成本：$20（订阅）+ ~$5（备份）= $25 总计
对比：$20 + 遇到限制 = 沮丧
```

### 场景 2："我想零成本"

**问题：** 负担不起订阅，需要可靠的 AI 编码

**解决方案：**
```
组合："free-forever"
  1. kr/claude-sonnet-4.5      （Claude 4.5 免费无限量）
  2. kr/glm-5                  （通过 Kiro 免费使用 GLM-5）
  3. oc/<auto>                 （OpenCode Free，无需认证）

月成本：$0
质量：生产级模型 + RTK 节省 20-40% tokens
```

### 场景 3："我需要 24/7 编码，不中断"

**问题：** 截止日期紧迫，不能承受停机

**解决方案：**
```
组合："always-on"
  1. cc/claude-opus-4-7        （最佳质量）
  2. cx/gpt-5.5                （第二个订阅）
  3. glm/glm-5.1               （低价，每日重置）
  4. minimax/MiniMax-M2.7      （最便宜，5小时重置）
  5. kr/claude-sonnet-4.5      （免费无限量）

结果：5 层切换 = 零停机时间
月成本：$20-200（订阅）+ $10-20（备份）
```

### 场景 4："我想在 OpenClaw 中使用免费 AI"

**问题：** 需要在消息应用（WhatsApp、Telegram、Slack...）中使用 AI 助手，完全免费

**解决方案：**
```
组合："openclaw-free"
  1. kr/claude-sonnet-4.5      （Claude 4.5 免费）
  2. kr/glm-5                  （GLM-5 免费）
  3. kr/MiniMax-M2.5           （MiniMax 免费）

月成本：$0
访问方式：WhatsApp、Telegram、Slack、Discord、iMessage、Signal...
```

---

## ❓ 常见问题

<details>
<summary><b>📊 为什么我的控制面板显示高成本？</b></summary>

控制面板追踪你的 token 使用情况，并显示**估算成本**，如同你直接使用付费 API。这**不是实际计费** — 它是一个参考，展示你通过使用免费模型或通过 9Router 路由现有订阅节省了多少钱。

**示例：**
- **控制面板显示：** "$290 总成本"
- **实际情况：** 你在使用 iFlow（免费无限量）
- **你的实际成本：** **$0.00**
- **$290 的含义：** 你通过使用免费模型而不是付费 API **节省**的金额！

成本显示是一个"节省追踪器"，帮助你了解使用模式和优化机会。

</details>

<details>
<summary><b>💳 9Router 会扣我的钱吗？</b></summary>

**不会。** 9Router 是在你自己的电脑上运行的开源软件。它永远不会向你收取任何费用。

**你只需支付：**
- ✅ **订阅提供商**（Claude Code $20/月、Codex $20-200/月）→ 在他们的网站上直接付款
- ✅ **低价提供商**（GLM、MiniMax）→ 直接付款，9Router 只是路由你的请求
- ❌ **9Router 本身** → **永不收费，永远不会**

9Router 是一个本地代理/路由器。它没有你的信用卡，不能发送发票，也没有计费系统。它是完全免费的软件。

</details>

<details>
<summary><b>🆓 免费提供商真的是无限量的吗？</b></summary>

**是的！** 当前的免费提供商（Kiro、OpenCode Free、Vertex）是真正的免费，**无隐藏费用**。

这些是各公司提供的免费服务：
- **Kiro AI**：通过 AWS Builder ID / Google / GitHub OAuth 免费无限量使用 Claude 4.5 + GLM-5 + MiniMax
- **OpenCode Free**：无认证直连代理，模型从 `opencode.ai/zen/v1/models` 自动获取
- **Vertex AI**：新 Google Cloud 账户可获得 $300 免费额度（90 天）

9Router 只是路由你的请求到它们 — 没有"陷阱"或未来的计费。它们是真正的免费服务，9Router 让它们易于使用并支持切换。

**已停止的免费等级（不再推荐）：**
- ❌ **iFlow**：曾是免费无限量，现在改为付费（2026）
- ❌ **Qwen Code**：阿里巴巴于 2026-04-15 停止免费 OAuth 等级
- ❌ **Gemini CLI**：仍可用，但与非 CLI 工具（Claude、Codex、Cursor...）一起使用可能会导致账户被封 — 仅在你坚持使用 Gemini CLI 本身时才使用

</details>

<details>
<summary><b>💰 如何最小化我的实际 AI 成本？</b></summary>

**免费优先策略：**

1. **从 100% 免费组合开始：**
   ```
   1. gc/gemini-3-flash (Google 每月 180K 免费)
   2. if/kimi-k2-thinking (iFlow 无限量免费)
   3. qw/qwen3-coder-plus (Qwen 无限量免费)
   ```
   **成本：$0/月**

2. **仅在需要时添加低价备份：**
   ```
   4. glm/glm-4.7 ($0.6/1M tokens)
   ```
   **额外成本：只为实际使用的部分付费**

3. **最后使用订阅提供商：**
   - 仅当你已有订阅时
   - 9Router 通过配额追踪帮助最大化其价值

**结果：** 大多数用户可以仅使用免费等级以 $0/月运行！

</details>

<details>
<summary><b>📈 如果我的使用量突然激增怎么办？</b></summary>

9Router 的智能切换可以防止意外费用：

**场景：** 你正在进行编码冲刺，用尽了配额

**没有 9Router：**
- ❌ 达到速率限制 → 工作停止 → 沮丧
- ❌ 或者：不慎累积大量 API 账单

**有 9Router：**
- ✅ 订阅达到限制 → 自动切换到低价等级
- ✅ 低价等级变得昂贵 → 自动切换到免费等级
- ✅ 编程永不停歇 → 可预测的成本

**你掌控一切：** 在控制面板中设置每个提供商的支出限制，9Router 会遵守它们。

</details>

---

## 📖 设置指南

<details>
<summary><b>🔐 订阅提供商（充分利用价值）</b></summary>

### Claude Code (Pro/Max)

```bash
控制面板 → 提供商 → 连接 Claude Code
→ OAuth 登录 → 自动 token 刷新
→ 5小时 + 每周配额追踪

模型：
  cc/claude-opus-4-7
  cc/claude-opus-4-6
  cc/claude-sonnet-4-6
  cc/claude-haiku-4-5-20251001
```

**专业提示：** 复杂任务使用 Opus，追求速度使用 Sonnet。9Router 按模型追踪配额！

### OpenAI Codex (Plus/Pro)

```bash
控制面板 → 提供商 → 连接 Codex
→ OAuth 登录（端口 1455）
→ 5小时 + 每周重置

模型：
  cx/gpt-5.5
  cx/gpt-5.4
  cx/gpt-5.3-codex
  cx/gpt-5.2-codex
```

### GitHub Copilot

```bash
控制面板 → 提供商 → 连接 GitHub
→ 通过 GitHub 进行 OAuth
→ 每月重置（每月 1 日）

模型：
  gh/gpt-5.4
  gh/claude-opus-4.7
  gh/claude-sonnet-4.6
  gh/gemini-3.1-pro-preview
  gh/grok-code-fast-1
```

### Cursor IDE

```bash
控制面板 → 提供商 → 连接 Cursor
→ OAuth 登录
→ 每月订阅

模型：
  cu/claude-4.6-opus-max
  cu/claude-4.5-sonnet-thinking
  cu/gpt-5.3-codex
```

</details>

<details>
<summary><b>💰 低价提供商（备份）</b></summary>

### GLM-5.1 / GLM-4.7（每日重置，$0.6/1M）

1. 注册：[Zhipu AI](https://open.bigmodel.cn/)
2. 从编程计划获取 API key
3. 控制面板 → 添加 API Key：
   - 提供商：`glm`
   - API Key：`your-key`

**使用：** `glm/glm-5.1`、`glm/glm-5`、`glm/glm-4.7`

**专业提示：** 编程计划提供 3 倍配额，成本仅为 1/7！每日 10:00 AM 重置。

### MiniMax M2.7（5小时重置，$0.20/1M）

1. 注册：[MiniMax](https://www.minimax.io/)
2. 获取 API key
3. 控制面板 → 添加 API Key

**使用：** `minimax/MiniMax-M2.7`、`minimax/MiniMax-M2.5`

**专业提示：** 长上下文（1M tokens）的最便宜选项！

### Kimi K2.5（$9/月固定）

1. 订阅：[Moonshot AI](https://platform.moonshot.ai/)
2. 获取 API key
3. 控制面板 → 添加 API Key

**使用：** `kimi/kimi-k2.5`、`kimi/kimi-k2.5-thinking`

**专业提示：** 每月 $9 固定费用获得 10M tokens = 实际成本 $0.90/1M！

</details>

<details>
<summary><b>🆓 免费提供商（推荐）</b></summary>

### Kiro AI（Claude 4.5 + GLM-5 + MiniMax 免费）

```bash
控制面板 → 连接 Kiro
→ AWS Builder ID、AWS IAM Identity Center、Google 或 GitHub
→ 无限量使用

模型：
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**专业提示：** Claude 最佳免费选项。无需 API key，无需付款，完全无限量。

### OpenCode Free（无需认证，自动获取模型）

```bash
控制面板 → 连接 OpenCode Free
→ 无需登录（直连代理）
→ 模型从 opencode.ai/zen/v1/models 自动获取
```

**专业提示：** 最快的设置。连接后即可开始编码。

### Vertex AI（新 GCP 账户 $300 免费额度）

```bash
控制面板 → 连接 Vertex AI
→ 上传 Google Cloud 服务账户 JSON
→ 在你的 GCP 项目中启用 Vertex AI API

模型：
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Vertex 合作伙伴（通过 Vertex 提供 Anthropic / DeepSeek / GLM / Qwen）：
  vertex-partner/glm-5-maas
  vertex-partner/deepseek-v3.2-maas
  vertex-partner/qwen3-next-80b-a3b-thinking-maas
```

**专业提示：** 新 Google Cloud 账户可获得 90 天内 $300 免费额度。足够日常编码使用。

</details>

<details>
<summary><b>🎨 创建组合</b></summary>

### 示例 1：充分利用订阅 → 低价备份

```
控制面板 → 组合 → 创建新组合

名称：premium-coding
模型：
  1. cc/claude-opus-4-7 (订阅主用)
  2. glm/glm-5.1 (低价备份，$0.6/1M)
  3. minimax/MiniMax-M2.7 (最便宜的备选，$0.20/1M)

在 CLI 中使用：premium-coding

月度成本示例（100M tokens）：
  80M 通过 Claude（订阅）：$0 额外费用
  15M 通过 GLM：$9
  5M 通过 MiniMax：$1
  总计：$10 + 你的订阅费用
```

### 示例 2：仅免费（零成本）

```
名称：free-combo
模型：
  1. kr/claude-sonnet-4.5 (Claude 4.5 免费无限量)
  2. kr/glm-5 (通过 Kiro 免费使用 GLM-5)
  3. vertex/gemini-3.1-pro-preview ($300 免费额度)

成本：通过 RTK 永久 $0（+ 节省 20-40% tokens）！
```

</details>

<details>
<summary><b>🔧 CLI 集成</b></summary>

### Cursor IDE

```
设置 → 模型 → 高级：
  OpenAI API Base URL：http://localhost:20128/v1
  OpenAI API Key：[来自 9router 控制面板]
  Model：cc/claude-opus-4-7
```

或使用组合：`premium-coding`

### Claude Code

编辑 `~/.claude/config.json`：

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

### OpenClaw

**选项 1 — 控制面板（推荐）：**

```
控制面板 → CLI 工具 → OpenClaw → 选择模型 → 应用
```

**选项 2 — 手动：** 编辑 `~/.openclaw/openclaw.json`：

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/kr/claude-sonnet-4.5"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "kr/claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5 (Kiro Free)"
          }
        ]
      }
    }
  }
}
```

> **注意：** OpenClaw 仅适用于本地 9Router。使用 `127.0.0.1` 而不是 `localhost` 以避免 IPv6 解析问题。

### Cline / Continue / RooCode

```
Provider：OpenAI 兼容
Base URL：http://localhost:20128/v1
API Key：[来自控制面板]
Model：cc/claude-opus-4-7
```

</details>

<details>
<summary><b>🚀 部署</b></summary>

### VPS 部署

```bash
# 克隆并安装
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# 配置
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# 启动
npm run start

# 或使用 PM2
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### Docker

```bash
# 构建镜像（从仓库根目录）
docker build -t 9router .

# 运行容器（当前设置使用的命令）
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file /root/dev/9router/.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

便携命令（如果你已经在仓库根目录）：

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file ./.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

容器默认值：
- `PORT=20128`
- `HOSTNAME=0.0.0.0`

常用命令：

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
```

### 环境变量

| 变量 | 默认值 | 描述 |
|----------|---------|-------------|
| `JWT_SECRET` | `9router-default-secret-change-me` | 用于控制面板 auth cookie 的 JWT 签名密钥（**生产环境请更改**） |
| `INITIAL_PASSWORD` | `123456` | 当没有保存的哈希时首次登录的密码 |
| `DATA_DIR` | `~/.9router` | 主应用数据库位置（`db.json`） |
| `PORT` | 框架默认值 | 服务端口（示例中为 `20128`） |
| `HOSTNAME` | 框架默认值 | 绑定主机（Docker 默认为 `0.0.0.0`） |
| `NODE_ENV` | 运行时默认值 | 设置 `production` 用于部署 |
| `BASE_URL` | `http://localhost:20128` | 云同步任务使用的服务端内部基础 URL |
| `CLOUD_URL` | `https://9router.com` | 服务端云同步端点基础 URL |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | 向后兼容/公开基础 URL（服务端运行时优先使用 `BASE_URL`） |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | 向后兼容/公开云 URL（服务端运行时优先使用 `CLOUD_URL`） |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | 生成 API key 的 HMAC 密钥 |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | 稳定机器 ID 哈希的盐值 |
| `ENABLE_REQUEST_LOGS` | `false` | 在 `logs/` 下启用请求/响应日志 |
| `AUTH_COOKIE_SECURE` | `false` | 强制 `Secure` auth cookie（在 HTTPS 反向代理后面设置为 `true`） |
| `REQUIRE_API_KEY` | `false` | 在 `/v1/*` 路由上强制使用 Bearer API key（面向互联网部署时推荐） |
| `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` | 空 | 用于上游提供商调用的可选出站代理 |

注意：
- 也支持小写代理变量：`http_proxy`、`https_proxy`、`all_proxy`、`no_proxy`。
- `.env` 不会打包到 Docker 镜像中（`.dockerignore`）；使用 `--env-file` 或 `-e` 注入运行时配置。
- 在 Windows 上，`APPDATA` 可用于本地存储路径解析。
- `INSTANCE_NAME` 出现在较旧的文档/环境变量模板中，但当前运行时未使用。

### 运行时文件和存储

- 主应用状态：`${DATA_DIR}/db.json`（提供商、组合、别名、密钥、设置），由 `src/lib/localDb.js` 管理。
- 使用历史和日志：`${DATA_DIR}/usage.json` 和 `${DATA_DIR}/log.txt`，由 `src/lib/usageDb.js` 管理。
- 可选的请求/翻译器日志：`ENABLE_REQUEST_LOGS=true` 时位于 `<repo>/logs/...`。
- `${DATA_DIR}` 和 `~/.9router` 在 Docker 容器中解析到同一位置 — 符号链接 `/root/.9router -> /app/data` 在构建时创建。

</details>

---

## 📊 可用模型

<details>
<summary><b>查看所有可用模型</b></summary>

**Claude Code（`cc/`）** - Pro/Max：
- `cc/claude-opus-4-7`
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex（`cx/`）** - Plus/Pro：
- `cx/gpt-5.5`
- `cx/gpt-5.4`
- `cx/gpt-5.3-codex`
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**GitHub Copilot（`gh/`）**：
- `gh/gpt-5.4`
- `gh/claude-opus-4.7`
- `gh/claude-sonnet-4.6`
- `gh/gemini-3.1-pro-preview`
- `gh/grok-code-fast-1`

**Cursor（`cu/`）** - 订阅：
- `cu/claude-4.6-opus-max`
- `cu/claude-4.5-sonnet-thinking`
- `cu/gpt-5.3-codex`
- `cu/kimi-k2.5`

**GLM（`glm/`）** - $0.6/1M：
- `glm/glm-5.1`
- `glm/glm-5`
- `glm/glm-4.7`

**MiniMax（`minimax/`）** - $0.2/1M：
- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.5`

**Kimi（`kimi/`）** - $9/月固定：
- `kimi/kimi-k2.5`
- `kimi/kimi-k2.5-thinking`

**Kiro（`kr/`）** - 免费无限量：
- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`
- `kr/glm-5`
- `kr/MiniMax-M2.5`
- `kr/qwen3-coder-next`
- `kr/deepseek-3.2`

**OpenCode Free（`oc/`）** - 免费无需认证：
- 从 `opencode.ai/zen/v1/models` 自动获取

**Vertex AI（`vertex/`）** - $300 免费额度：
- `vertex/gemini-3.1-pro-preview`
- `vertex/gemini-3-flash-preview`
- `vertex/gemini-2.5-flash`
- `vertex-partner/glm-5-maas`
- `vertex-partner/deepseek-v3.2-maas`

</details>

---

## 🐛 故障排除

**"语言模型未提供消息"**
- 提供商配额耗尽 → 检查控制面板配额追踪器
- 解决方案：使用组合切换或切换到更便宜的等级

**速率限制**
- 订阅配额用完 → 切换到 GLM/MiniMax
- 添加组合：`cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`

**OAuth token 已过期**
- 9Router 自动刷新
- 如果问题持续：控制面板 → 提供商 → 重新连接

**高成本**
- 在控制面板 → 端点设置中启用 RTK（默认开启，节省 20-40% tokens）
- 在控制面板中检查使用统计
- 将主模型切换到 GLM/MiniMax
- 对于非关键任务使用免费等级（Kiro、OpenCode Free、Vertex）

**控制面板在错误端口打开**
- 设置 `PORT=20128` 和 `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**首次登录不工作**
- 检查 `.env` 中的 `INITIAL_PASSWORD`
- 如果未设置，回退密码是 `123456`

**`logs/` 下没有请求日志**
- 设置 `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ 技术栈

- **运行时**：Node.js 20+
- **框架**：Next.js 16
- **UI**：React 19 + Tailwind CSS 4
- **数据库**：LowDB（基于 JSON 文件）
- **流式传输**：Server-Sent Events (SSE)
- **认证**：OAuth 2.0 (PKCE) + JWT + API Keys

---

## 📝 API 参考

### 聊天补全

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "Write a function to..."}
  ],
  "stream": true
}
```

### 列出模型

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ 以 OpenAI 格式返回所有模型和组合
```

## 📧 支持

- **网站**：[9router.com](https://9router.com)
- **GitHub**：[github.com/decolua/9router](https://github.com/decolua/9router)
- **问题**：[github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 贡献者

感谢所有帮助改进 9Router 的贡献者！

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1&v=20260309)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Star 图表

[![Star Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)



## 🔀 分支

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — 9Router 的全功能 TypeScript 分支。增加了 36+ 提供商、4 层自动切换、多模态 API（图像、嵌入、音频、TTS）、断路器、语义缓存、LLM 评估和精美的控制面板。368+ 单元测试。可通过 npm 和 Docker 使用。

---

## 🙏 致谢

站在巨人的肩膀上构建：

- **CLIProxyAPI** — 启发了这个 JavaScript 移植的原始 Go 实现。
- **[RTK](https://github.com/rtk-ai/rtk)** ![Stars](https://img.shields.io/github/stars/rtk-ai/rtk?style=flat&color=yellow) — Rust token 节省器。9Router 将其压缩管道移植到 JS → 每次请求 **减少 20-40% 输入 tokens**。
- **[Caveman](https://github.com/JuliusBrussee/caveman)** ![Stars](https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow) by **[@JuliusBrussee](https://github.com/JuliusBrussee)** — 病毒式传播的 *"为什么用很多 token 当少的 token 就能搞定"*。9Router 适配其提示词 → **减少 65% 输出 tokens**。

非常感谢这些作者 — 没有他们的工作，9Router 的 token 节省功能就不会存在。在 GitHub 上给他们加星！

---

## 📄 许可证

MIT 许可证 — 详见 [LICENSE](LICENSE)。

---

<div align="center">
  <sub>用 ❤️ 为 24/7 编程的开发者构建</sub>
</div>