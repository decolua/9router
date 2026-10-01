# Cline Integration

Integrate 9Router with Cline VSCode extension to route your AI requests through 9Router's intelligent routing system.

## Prerequisites

- Visual Studio Code installed
- Cline extension installed from VSCode marketplace
- 9Router running locally or cloud endpoint configured
- API key from 9Router dashboard

## Setup

### 1. Open Cline Settings

1. Open Visual Studio Code
2. Open the Cline extension panel (click the Cline icon in the sidebar)
3. Click the **Settings** icon (gear icon) in the Cline panel

### 2. Select API Provider

1. In the Cline settings, find **API Provider** dropdown
2. Select **Ollama** from the list
   - Note: We use Ollama provider type because it's compatible with OpenAI-style APIs

### 3. Configure Base URL

Set the base URL to your 9Router endpoint:

**For Local 9Router:**
```
http://localhost:20128/v1
```

**For Cloud 9Router:**
```
https://9router.com
```

**Steps:**
1. In the **Base URL** field, enter your 9Router endpoint
2. Make sure to include `/v1` at the end

### 4. Add API Key

1. In the **API Key** field, enter your 9Router API key
2. You can find your API key in the 9Router dashboard under **Settings → API Keys**
3. The key should start with `sk-9router-`

### 5. Select Model

1. In the **Model** dropdown, you can either:
   - Select from available models (if Cline auto-detects them)
   - Manually enter the model name from your 9Router configuration

2. Common model names:
   - `gpt-4`
   - `gpt-4o`
   - `claude-opus-4-5`
   - `claude-sonnet-4-5`
   - `gemini-2.0-flash`

### 6. Save Configuration

Click **Save** or close the settings panel. Cline will automatically save your configuration.

## Configuration Example

Your Cline settings should look like this:

```
API Provider: Ollama
Base URL: http://localhost:20128/v1
API Key: sk-9router-xxxxxxxxxxxxx
Model: gpt-4
```

## Available Models

You can use any model configured in your 9Router dashboard. Common examples:

| Model Name | Provider | Description |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## Usage

### Chat with AI

1. Open the Cline panel in VSCode
2. Type your message in the chat input
3. Press Enter to send
4. Cline will use 9Router to process your request

### Code Generation

1. Ask Cline to generate code: "Create a React component for a login form"
2. Cline will generate code using 9Router
3. Review and accept the generated code

### Code Explanation

1. Select code in your editor
2. Ask Cline: "Explain this code"
3. Get AI-powered explanations through 9Router

### File Operations

1. Ask Cline to create, modify, or delete files
2. Cline will use 9Router to understand context and make changes
3. Review changes before accepting

## Troubleshooting

### "Connection Failed" Error

1. Verify 9Router is running: `curl http://localhost:20128/health`
2. Check that the base URL is correct and includes `/v1`
3. Ensure no firewall is blocking port 20128
4. Try restarting VSCode

### "Invalid API Key" Error

1. Verify your API key in 9Router dashboard
2. Make sure you copied the entire key including the `sk-9router-` prefix
3. Check that the API key has not expired
4. Try regenerating a new API key

### "Model Not Found" Error

1. Verify the model name matches exactly with your 9Router configuration
2. Check that the provider connection is active in 9Router dashboard
3. Ensure the model is available in your connected providers
4. Try using the full model name (e.g., `openai/gpt-4` instead of `gpt-4`)

### Cline Not Responding

1. Check the Cline output panel for error messages
2. Verify your 9Router instance is running and healthy
3. Try reloading VSCode window (Cmd/Ctrl + Shift + P → "Reload Window")
4. Check 9Router logs for any errors

## Advanced Configuration

### Using Cloud Endpoint

To use 9Router cloud endpoint instead of localhost:

1. In Cline settings, set Base URL to: `https://9router.com`
2. Make sure you have configured your API key in the 9Router cloud dashboard
3. Ensure your cloud endpoint is active and accessible

### Multiple Models

You can quickly switch between models:

1. Open Cline settings
2. Change the **Model** field to a different model
3. Save and continue chatting with the new model

### Custom Timeout

If you experience timeout issues with large requests:

1. Open VSCode settings (Cmd/Ctrl + ,)
2. Search for "Cline timeout"
3. Increase the timeout value (default is usually 30 seconds)

## Best Practices

1. **Use Appropriate Models**: Choose faster models (like Haiku or Flash) for simple tasks, and more powerful models (like Opus or GPT-4) for complex tasks
2. **Monitor Usage**: Check 9Router dashboard for usage statistics and costs
3. **Context Management**: Keep your conversations focused to reduce token usage
4. **Model Switching**: Switch models based on task complexity to optimize cost and performance
5. **API Key Security**: Never commit your API key to version control

## Integration with 9Router Features

### Model Routing

9Router automatically routes your requests to the best available provider based on:
- Model availability
- Provider health status
- Cost optimization
- Load balancing

### Fallback Support

If a provider fails, 9Router automatically falls back to alternative providers configured in your dashboard.

### Usage Tracking

Monitor your Cline usage through 9Router dashboard:
- Total requests
- Token usage
- Cost per model
- Provider distribution
