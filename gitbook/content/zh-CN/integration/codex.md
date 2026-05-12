# OpenAI Codex CLI 集成

将 9Router 与 OpenAI Codex CLI 集成,通过 9Router 的智能路由系统转发你的 OpenAI API 请求。

## 前置要求

- 已安装 OpenAI Codex CLI
- 9Router 本地运行或已配置云端 endpoint
- 来自 9Router 仪表盘的 API key

## 设置

### 1. 配置环境变量

在 shell 配置文件(`~/.bashrc`、`~/.zshrc` 或 `~/.bash_profile`)中设置以下环境变量:

```bash
# 9Router 的 Base URL
export OPENAI_BASE_URL="http://localhost:20128/v1"

# 来自 9Router 仪表盘的 API Key
export OPENAI_API_KEY="your-9router-api-key"
```

### 2. 重新加载 Shell 配置

```bash
source ~/.zshrc  # 或 ~/.bashrc
```

### 3. 验证配置

检查环境变量是否设置正确:

```bash
echo $OPENAI_BASE_URL
echo $OPENAI_API_KEY
```

## 可用模型

9Router 提供以下 Codex 模型:

| 模型 ID | 描述 |
|----------|-------------|
| `cx/gpt-5.2-codex` | GPT-5.2 Codex - 最新版本 |
| `cx/gpt-5.1-codex-max` | GPT-5.1 Codex Max - 扩展上下文 |

## 使用示例

### 基础用法

```bash
# 使用 GPT-5.2 Codex
codex --model cx/gpt-5.2-codex "Write a function to sort an array"

# 使用 GPT-5.1 Codex Max
codex --model cx/gpt-5.1-codex-max "Explain this complex algorithm"
```

### 代码生成

```bash
codex --model cx/gpt-5.2-codex "Create a REST API endpoint for user authentication"
```

### 代码解释

```bash
codex --model cx/gpt-5.1-codex-max "Explain what this code does: $(cat myfile.js)"
```

## 配置文件

也可以通过配置文件配置 Codex CLI。创建或编辑 `~/.codex/config.json`:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "apiKey": "your-9router-api-key",
  "defaultModel": "cx/gpt-5.2-codex"
}
```

## 故障排除

### 认证错误

遇到认证错误时:

1. 在 9Router 仪表盘中确认 API key 正确
2. 检查 `OPENAI_API_KEY` 环境变量已设置
3. 确认 API key 未过期

### 连接问题

遇到连接错误时:

1. 确认 9Router 正在运行:`curl http://localhost:20128/health`
2. 检查环境变量设置是否正确
3. 确保防火墙没有阻止 20128 端口

### 模型不可用

出现 "model not available" 错误时:

1. 确认模型名与 9Router 配置一致
2. 检查 9Router 仪表盘中 OpenAI 提供商连接是否激活
3. 确认连接的提供商中包含该模型

## 云端 Endpoint

使用 9Router 云端 endpoint 而非 localhost:

```bash
export OPENAI_BASE_URL="https://9router.com"
```

确保已在 9Router 云端仪表盘中配置 API key。

## 高级配置

### 自定义超时

```bash
export OPENAI_TIMEOUT=60  # 秒
```

### Debug 模式

启用 debug 模式查看详细请求/响应日志:

```bash
export CODEX_DEBUG=true
codex --model cx/gpt-5.2-codex "Your prompt"
```
