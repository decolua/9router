# Roo AI Assistant Integration

Integrate 9Router with Roo AI Assistant to access multiple AI models through a unified interface.

## Prerequisites

- Roo AI Assistant installed
- 9Router API key from [dashboard](https://9router.com/dashboard)
- 9Router running (local or cloud)

## Configuration Steps

### 1. Open Roo Settings

Launch Roo AI Assistant and open the settings panel.

### 2. Configure API Provider

1. Navigate to **API Provider** settings
2. Select **Ollama** as the provider type
3. Configure the following settings:

**For Local 9Router:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
```

**For Cloud 9Router:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
```

### 3. Select Model

Choose from available 9Router models:

**Claude Models:**
- `cc/claude-opus-4-5-20251101` - Most capable
- `cc/claude-sonnet-4-20250514` - Balanced
- `cc/claude-haiku-4-20250514` - Fast

**DeepSeek Models:**
- `cx/deepseek-chat` - General purpose
- `cx/deepseek-reasoner` - Complex reasoning

**GLM Models:**
- `glm/glm-4-plus` - Advanced
- `glm/glm-4-flash` - Fast responses

### 4. Test Connection

Send a test message to verify the integration:

```
Hello! Can you confirm you're connected through 9Router?
```

## Usage Examples

### Basic Chat
```
Ask Roo: "Explain quantum computing in simple terms"
Model: cc/claude-sonnet-4-20250514
```

### Code Generation
```
Ask Roo: "Write a Python function to calculate Fibonacci numbers"
Model: cx/deepseek-chat
```

### Complex Reasoning
```
Ask Roo: "Analyze the trade-offs between microservices and monolithic architecture"
Model: cx/deepseek-reasoner
```

## Model Selection Tips

- **Quick tasks**: Use `cc/claude-haiku-4-20250514` or `glm/glm-4-flash`
- **Balanced performance**: Use `cc/claude-sonnet-4-20250514` or `cx/deepseek-chat`
- **Complex reasoning**: Use `cc/claude-opus-4-5-20251101` or `cx/deepseek-reasoner`
- **Cost optimization**: Use DeepSeek or GLM models

## Troubleshooting

### Connection Failed
- Verify 9Router is running: `curl http://localhost:20128/health`
- Check API key is correct
- Ensure Base URL includes `/v1` suffix

### Model Not Available
- Check model name matches exactly (case-sensitive)
- Verify model is enabled in your 9Router plan
- Try a different model from the list

### Slow Responses
- Switch to faster models (haiku, flash)
- Check network connection
- Monitor 9Router logs for issues

## Advanced Configuration

### Custom Model Aliases

You can create shortcuts for frequently used models in Roo settings:

```
Alias: "fast" → cc/claude-haiku-4-20250514
Alias: "smart" → cc/claude-opus-4-5-20251101
Alias: "code" → cx/deepseek-chat
```

### Multiple Profiles

Set up different profiles for different use cases:
- **Development**: DeepSeek models for code
- **Writing**: Claude models for content
- **Research**: Reasoner models for analysis

## Next Steps

- [Configure Cursor](cursor.md) for IDE integration
- [Set up Continue](continue.md) for VSCode
- [Explore CLI usage](../cli/basic-usage.md)
