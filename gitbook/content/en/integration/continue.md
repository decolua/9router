# Continue VSCode Extension Integration

Integrate 9Router with Continue extension to bring AI assistance directly into Visual Studio Code.

## Prerequisites

- Visual Studio Code installed
- Continue extension installed from VSCode marketplace
- 9Router API key from [dashboard](https://9router.com/dashboard)
- 9Router running (local or cloud)

## Configuration Steps

### 1. Open Continue Configuration

1. Open VSCode
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "Continue: Open Config" and select it
4. This opens `~/.continue/config.json`

### 2. Add 9Router Model Configuration

Add the following configuration to your `config.json`:

**Single Model Setup:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**Multiple Models Setup:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus (Best)",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Sonnet (Balanced)",
      "provider": "openai",
      "model": "cc/claude-sonnet-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - DeepSeek Chat (Code)",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Haiku (Fast)",
      "provider": "openai",
      "model": "cc/claude-haiku-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**For Cloud 9Router:**
Replace `apiBase` with:
```json
"apiBase": "https://9router.com/v1"
```

### 3. Save and Reload

1. Save the configuration file
2. Reload VSCode window: `Cmd+Shift+P` → "Developer: Reload Window"
3. Continue extension will load the new configuration

### 4. Select Model

1. Open Continue sidebar (click Continue icon in left panel)
2. Click model selector dropdown at the top
3. Choose your preferred 9Router model

## Available Models

### Claude Models (Anthropic)
- `cc/claude-opus-4-5-20251101` - Most capable, best for complex tasks
- `cc/claude-sonnet-4-20250514` - Balanced performance and speed
- `cc/claude-haiku-4-20250514` - Fastest, good for simple tasks

### DeepSeek Models
- `cx/deepseek-chat` - Excellent for code generation
- `cx/deepseek-reasoner` - Best for complex problem solving

### GLM Models (Zhipu AI)
- `glm/glm-4-plus` - Advanced Chinese and English
- `glm/glm-4-flash` - Fast responses

## Usage Examples

### Code Explanation
1. Select code in editor
2. Open Continue sidebar
3. Type: "Explain this code"
4. Model: `cc/claude-sonnet-4-20250514`

### Code Generation
1. Open Continue sidebar
2. Type: "Create a React component for user profile card"
3. Model: `cx/deepseek-chat`

### Refactoring
1. Select code to refactor
2. Type: "Refactor this to use async/await"
3. Model: `cc/claude-sonnet-4-20250514`

### Bug Fixing
1. Select problematic code
2. Type: "Find and fix the bug in this code"
3. Model: `cx/deepseek-reasoner`

## Advanced Configuration

### Custom System Prompts

Add custom system prompts for specific behaviors:

```json
{
  "models": [
    {
      "title": "9Router - Code Expert",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "systemMessage": "You are an expert programmer. Always provide clean, well-documented code with best practices."
    }
  ]
}
```

### Temperature and Parameters

Adjust model behavior with parameters:

```json
{
  "models": [
    {
      "title": "9Router - Creative Writer",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "temperature": 0.9,
      "topP": 0.95
    }
  ]
}
```

### Context Providers

Configure what context Continue sends to the model:

```json
{
  "contextProviders": [
    {
      "name": "code",
      "params": {
        "maxLines": 100
      }
    },
    {
      "name": "diff",
      "params": {}
    },
    {
      "name": "terminal",
      "params": {}
    }
  ]
}
```

## Keyboard Shortcuts

- `Cmd+L` (Mac) / `Ctrl+L` (Windows/Linux) - Open Continue chat
- `Cmd+I` (Mac) / `Ctrl+I` (Windows/Linux) - Inline edit
- `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux) - Regenerate response

## Troubleshooting

### Model Not Responding
- Check 9Router is running: `curl http://localhost:20128/health`
- Verify API key in config.json
- Check VSCode Developer Console for errors: `Help` → `Toggle Developer Tools`

### Wrong Model Selected
- Click model dropdown in Continue sidebar
- Select correct 9Router model
- Model name must match exactly (case-sensitive)

### Configuration Not Loading
- Verify JSON syntax is valid (use JSON validator)
- Check file location: `~/.continue/config.json`
- Reload VSCode window after changes

### Slow Performance
- Switch to faster models (haiku, flash)
- Reduce context size in contextProviders
- Check network latency to 9Router

## Best Practices

### Model Selection Strategy
- **Quick edits**: Use `cc/claude-haiku-4-20250514`
- **Code generation**: Use `cx/deepseek-chat`
- **Complex refactoring**: Use `cc/claude-opus-4-5-20251101`
- **Problem solving**: Use `cx/deepseek-reasoner`

### Context Management
- Select only relevant code before asking
- Use specific, clear prompts
- Break complex tasks into smaller steps

### Cost Optimization
- Use faster/cheaper models for simple tasks
- Limit context size when possible
- Cache frequently used responses

## Next Steps

- [Configure Cursor](cursor.md) for enhanced IDE integration
- [Set up Roo](roo.md) for AI assistant
- [Explore CLI usage](../cli/basic-usage.md)
- [Learn about model selection](../models/overview.md)
