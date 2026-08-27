<div align="center">
  <img src="./images/9router.png?1" alt="9Router Dashboard" width="800"/>

  # 9Router

  **专为开发者打造的通用 AI 模型路由与 Token 节省器**

  告别速率限制。内置 RTK 节省 20–40% 输入 tokens，充分利用订阅配额，并自动回退到低价或免费模型。

  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

  <a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

  [🚀 快速开始](#-快速开始) • [✨ 核心功能](#-核心功能) • [🔌 工具接入](#-接入-cli-编程工具) • [🌐 官方网站](https://9router.com)

  [English](./README.md) • [Tiếng Việt](./i18n/README.vi.md) • [日本語](./i18n/README.ja-JP.md) • [Español](./i18n/README.es.md) • [Français](./i18n/README.fr.md)
</div>

---

## 💡 什么是 9Router？

9Router 是一个运行在本地的 AI 网关代理，位于你的编程工具（Claude Code、Cursor、Codex、OpenClaw、Cline、Roo）与各个 AI 提供商之间。

- 🗜️ **节省 20–40% Tokens**：内置 RTK 智能压缩命令行输出（`git diff`、`grep`、`ls`、日志等）。
- 🔄 **编程不中断**：自动三级回退（订阅提供商 → 超低价提供商 → 免费提供商）。
- 📊 **实时配额追踪**：精准掌握各提供商 5 小时滚动窗口、每日与每月重置倒计时。
- 🔌 **通用格式转换**：单一端口同时支持 OpenAI、Claude、Gemini 等协议转换。

---

## 🔄 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│ 编程工具 (Claude Code, Cursor, Codex, OpenClaw, Cline 等)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ http://localhost:20128/v1
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                           9Router                           │
│  • RTK 输出压缩           • 协议格式转换 (OpenAI ↔ Claude)    │
│  • 实时配额与额度追踪     • 多账号负载均衡与轮询              │
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
       [ 第 1 级: 已有订阅 ]          [ 第 2 级: 超低价 ]     [ 第 3 级: 免费兜底 ]
       • Claude Code (Pro/Max)        • GLM ($0.6/1M)         • Kiro AI (Claude/GLM 免费额度)
       • OpenAI Codex (Plus/Pro)      • MiniMax ($0.2/1M)     • OpenCode Free (免登录)
       • GitHub Copilot / Cursor      • Kimi ($9/月包月)      • Vertex AI ($300 赠金)
```

---

## ⚡ 快速开始

### 1. 运行 9Router

**方式 A：npm 全局安装（推荐桌面使用）**
```bash
npm install -g 9router
9router
```

**方式 B：Docker 运行（推荐服务器 / VPS）**
```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

**方式 C：源码运行（本地开发）**
```bash
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run dev
```

控制台面板访问地址：**`http://localhost:20128`**（初始密码：`123456`）。

---

### 2. 连接模型提供商

在控制台页面（`http://localhost:20128`）进入 **Providers**：
- **免费方案**：连接 **Kiro AI**（免费提供 Claude 4.5 与 GLM-5 额度）或 **OpenCode Free**（无需凭证）。
- **订阅方案**：通过 OAuth 一键授权你的 **Claude Code**、**Codex** 或 **GitHub Copilot** 账号。
- **低价 API Key**：添加 **GLM**（$0.60/1M）或 **MiniMax**（$0.20/1M）API 密钥。

---

### 3. 接入 CLI 编程工具

将工具的 API 终端地址设为 `http://localhost:20128/v1`：

| 工具 | 配置方式 |
|---|---|
| **Claude Code** | 在 `~/.bashrc` 或 `~/.zshrc` 中添加 `export ANTHROPIC_BASE_URL="http://localhost:20128/v1"` |
| **OpenAI Codex** | 设置 `OPENAI_BASE_URL="http://localhost:20128/v1"`，API Key 可填任意字符串（如 `sk_9router`） |
| **Cursor** | 设置 → Models → OpenAI Base URL: `http://localhost:20128/v1` |
| **Cline / Roo** | 提供商选择 `OpenAI Compatible`，Base URL: `http://localhost:20128/v1` |
| **OpenClaw** | 进入控制台 → CLI Tools → OpenClaw → 选择模型并一键应用（或使用 `http://127.0.0.1:20128/v1`） |

---

## 🏷️ 模型前缀规则

使用统一前缀调用目标模型：

| 前缀 | 提供商 | 推荐模型 | 说明 |
|---|---|---|---|
| `cc/` | Claude Code | `cc/claude-opus-4-7`, `cc/claude-sonnet-4-6` | 消耗 Claude 官方订阅 |
| `cx/` | OpenAI Codex | `cx/gpt-5.5`, `cx/gpt-5.4`, `cx/gpt-5.3-codex` | 消耗 ChatGPT Plus/Pro 订阅 |
| `gh/` | GitHub Copilot | `gh/gpt-5.4`, `gh/claude-opus-4.7` | 消耗 Copilot 订阅 |
| `cu/` | Cursor | `cu/claude-4.6-opus-max`, `cu/gpt-5.3-codex` | 消耗 Cursor 账户配额 |
| `kr/` | Kiro AI | `kr/claude-sonnet-4.5`, `kr/glm-5` | 免费额度（AWS Builder ID / Google） |
| `glm/` | 智谱 GLM | `glm/glm-5.1`, `glm/glm-4.7` | 约 $0.60 / 1M 输入 tokens |
| `minimax/` | MiniMax | `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5` | 约 $0.20 / 1M 输入 tokens |
| `vertex/` | Google Vertex | `vertex/gemini-3.1-pro-preview` | GCP 赠金 / Vertex AI Studio |
| `oc/` | OpenCode Free | 自动从服务器获取模型列表 | 免费免登录模型 |

---

## ✨ 核心功能

- 🚀 **RTK 输出压缩**：无损压缩 `tool_result` 中的长输出（如 `git diff`、`grep`、`find` 等），减少 20–40% 上下文消耗。
- 🔀 **自定义组合 (Combos)**：自由配置回退链，如 `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`。
- 👥 **多账号负载均衡**：单个提供商支持绑定多个账号，自动轮询并均衡请求。
- ⏳ **精准配额倒计时**：清晰显示 5 小时滚动窗口、每日与每月重置状态。
- 🔒 **本地安全存储**：所有配置和使用历史保存在本地 SQLite 数据库（`~/.9router/db/data.sqlite`）。

---

## ⚙️ 常用环境变量

| 变量名 | 默认值 | 作用 |
|---|---|---|
| `PORT` | `20128` | 服务监听端口 |
| `DATA_DIR` | `~/.9router` | SQLite 数据库和配置存储目录 |
| `INITIAL_PASSWORD` | `123456` | 初始控制台登录密码 |
| `JWT_SECRET` | 自动生成 | JWT 签名密钥（生产环境建议自定义） |
| `ENABLE_REQUEST_LOGS`| `false` | 是否在 `logs/` 目录记录详细请求日志 |
| `REQUIRE_API_KEY` | `false` | 是否强制验证 `/v1/*` 请求的 API Key |

---

## 💰 计费说明

- **9Router 软件本身完全免费且开源**，永不收取任何费用。
- **控制台显示的费用仅为参考估算**，用于直观对比使用标准 API 所节省的金额。
- 你只需直接向第三方模型提供商付费（使用免费模型时实际花费为 $0）。

---

## 📄 开源许可

基于 MIT License 协议开源。
