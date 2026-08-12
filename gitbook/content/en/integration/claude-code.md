# Claude Code Integration

Integrate 10router with Claude Code CLI to route your Anthropic API requests through 10router's intelligent routing system.

## Prerequisites

- Claude Code CLI installed
- 10router running locally or cloud endpoint configured
- API key from 10router dashboard

## Setup

### 1. Configure Environment Variables

Set the following environment variables in your shell configuration file (`~/.bashrc`, `~/.zshrc`, or `~/.bash_profile`):

```bash
# Base URL for 10router
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"

# Optional: Set default models for aliases
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-4-5-20251101"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-4-5-20250929"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. Reload Shell Configuration

```bash
source ~/.zshrc  # or ~/.bashrc
```

### 3. Verify Configuration

Check that the environment variables are set correctly:

```bash
echo $ANTHROPIC_BASE_URL
```

## Model Aliases

Claude Code supports the following model aliases that map to 10router models:

| Alias | Model | Environment Variable |
|-------|-------|---------------------|
| `opus` | Claude Opus 4.5 | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | Claude Sonnet 4.5 | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | Claude Haiku 4.5 | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

## Usage Examples

### Using Model Aliases

```bash
# Use Opus model
claude --model opus "Explain quantum computing"

# Use Sonnet model
claude --model sonnet "Write a Python function"

# Use Haiku model
claude --model haiku "Quick code review"
```

### Using Full Model Names

```bash
claude --model cc/claude-opus-4-5-20251101 "Your prompt here"
```

## Settings File

Claude Code stores its configuration in `~/.claude/settings.json`. You can manually edit this file if needed:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "defaultModel": "sonnet"
}
```

## Troubleshooting

### Connection Issues

If you encounter connection errors:

1. Verify 10router is running: `curl http://localhost:20128/health`
2. Check environment variables are set correctly
3. Ensure no firewall is blocking port 20128

### Model Not Found

If you get "model not found" errors:

1. Verify the model name matches your 10router configuration
2. Check that the provider connection is active in 10router dashboard
3. Ensure the model is available in your connected providers

## Remote Endpoint

To point at a 10router instance you self-host on another machine (VPS, home server, tunnel) instead of localhost:

```bash
export ANTHROPIC_BASE_URL="https://your-10router-host"
```

Make sure you have created an API key in that instance's dashboard.
