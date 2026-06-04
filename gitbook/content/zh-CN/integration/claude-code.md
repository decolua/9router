# Claude Code 集成

将 9Router 与 Claude Code CLI 集成,通过 9Router 的智能路由系统转发你的 Anthropic API 请求。

## 前置要求

- 已安装 Claude Code CLI
- 9Router 本地运行或已配置云端 endpoint
- 来自 9Router 仪表盘的 API key

## 设置

### 1. 配置环境变量

在 shell 配置文件(`~/.bashrc`、`~/.zshrc` 或 `~/.bash_profile`)中设置以下环境变量:

```bash
# 9Router 的 Base URL
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"

# 可选: 为别名设置默认模型
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-4-5-20251101"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-4-5-20250929"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. 重新加载 Shell 配置

```bash
source ~/.zshrc  # 或 ~/.bashrc
```

### 3. 验证配置

检查环境变量是否设置正确:

```bash
echo $ANTHROPIC_BASE_URL
```

## 模型别名

Claude Code 支持以下模型别名,映射到 9Router 模型:

| 别名 | 模型 | 环境变量 |
|-------|-------|---------------------|
| `opus` | Claude Opus 4.5 | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | Claude Sonnet 4.5 | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | Claude Haiku 4.5 | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

## 使用示例

### 使用模型别名

```bash
# 使用 Opus 模型
claude --model opus "Explain quantum computing"

# 使用 Sonnet 模型
claude --model sonnet "Write a Python function"

# 使用 Haiku 模型
claude --model haiku "Quick code review"
```

### 使用完整模型名

```bash
claude --model cc/claude-opus-4-5-20251101 "Your prompt here"
```

## 配置文件

Claude Code 将配置存储在 `~/.claude/settings.json`。如有需要可手动编辑:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "defaultModel": "sonnet"
}
```

## 故障排除

### 连接问题

遇到连接错误时:

1. 确认 9Router 正在运行:`curl http://localhost:20128/health`
2. 检查环境变量设置是否正确
3. 确保防火墙没有阻止 20128 端口

### 模型未找到

出现 "model not found" 错误时:

1. 确认模型名与 9Router 配置一致
2. 检查 9Router 仪表盘中提供商连接是否激活
3. 确认所连接的提供商中包含该模型

## 云端 Endpoint

使用 9Router 云端 endpoint 而非 localhost:

```bash
export ANTHROPIC_BASE_URL="https://9router.com"
```

确保已在 9Router 云端仪表盘中配置 API key。
