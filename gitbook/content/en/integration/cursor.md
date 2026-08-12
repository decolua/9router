# Cursor Integration

Integrate 10router with Cursor IDE to route your AI requests through 10router's intelligent routing system.

## Prerequisites

- Cursor IDE installed
- Cursor Pro account (required for custom API endpoints)
- A publicly reachable 10router endpoint (a VPS, or a tunnel to your local instance)
- API key from your 10router dashboard

## ⚠️ Important Notes

> **Public Endpoint Required**: Cursor routes requests through its own server and does not support localhost endpoints. You must point it at a publicly reachable 10router URL, e.g. `https://your-10router-host`

> **Cursor Pro Required**: This feature requires a Cursor Pro account to use custom API endpoints.

## Setup

### 1. Open Cursor Settings

1. Open Cursor IDE
2. Go to **Settings** (Cmd/Ctrl + ,)
3. Navigate to **Models** section

### 2. Enable OpenAI API

1. Find the **OpenAI API key** option
2. Enable the toggle to activate custom API configuration

### 3. Configure Base URL

Set the base URL to your 10router endpoint:

```
https://your-10router-host
```

**Steps:**
1. In the Models settings, locate the **Base URL** field
2. Enter: `https://your-10router-host`
3. Click **Save**

### 4. Add API Key

1. In the **API Key** field, enter your 10router API key
2. You can find your API key in the 10router dashboard under **Settings → API Keys**
3. Click **Save**

### 5. Add Custom Model

1. Click **View All Models** button
2. Click **Add Custom Model**
3. Enter the model name from your 10router configuration (e.g., `gpt-4`, `claude-opus-4-5`, etc.)
4. Click **Add**

### 6. Select Model

1. In the Cursor chat interface, click the model selector dropdown
2. Choose your custom model from the list
3. Start using 10router with Cursor!

## Configuration Example

Your Cursor settings should look like this:

```
OpenAI API: ✓ Enabled
Base URL: https://your-10router-host
API Key: sk-10router-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## Available Models

You can use any model configured in your 10router dashboard. Common examples:

| Model Name | Provider | Description |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## Usage

### Chat Interface

1. Open Cursor chat (Cmd/Ctrl + L)
2. Select your model from the dropdown
3. Start chatting with AI through 10router

### Inline Code Generation

1. Select code in your editor
2. Press Cmd/Ctrl + K
3. Enter your prompt
4. Cursor will use 10router to generate code

### Code Explanation

1. Select code in your editor
2. Press Cmd/Ctrl + L
3. Ask "Explain this code"
4. Get AI-powered explanations through 10router

## Troubleshooting

### "Invalid API Key" Error

1. Verify your API key in 10router dashboard
2. Make sure you copied the entire key including the `sk-10router-` prefix
3. Check that the API key has not expired
4. Try regenerating a new API key

### "Model Not Found" Error

1. Verify the model name matches exactly with your 10router configuration
2. Check that the provider connection is active in 10router dashboard
3. Ensure the model is available in your connected providers
4. Try using the full model name (e.g., `openai/gpt-4` instead of `gpt-4`)

### Connection Issues

1. Verify you are using your public endpoint: `https://your-10router-host`
2. Check your internet connection
3. Ensure your 10router instance is running and reachable from the internet
4. Try disabling VPN or proxy if enabled

### Localhost Not Working

> **Remember**: Cursor does not support localhost endpoints. It must reach 10router over a public URL. If you are running 10router locally, expose it with a tunneling service such as ngrok or Cloudflare Tunnel.

## Exposing a Local Instance

If you're running 10router locally and want to use it with Cursor:

1. Start 10router locally (default port `20128`)
2. Open a tunnel to it, e.g. `ngrok http 20128` or `cloudflared tunnel --url http://localhost:20128`
3. Use the public HTTPS URL the tunnel gives you as the Base URL in Cursor settings
4. Keep both the local instance and the tunnel running while you use Cursor

## Best Practices

1. **Use Model Aliases**: Create short aliases for frequently used models in 10router
2. **Monitor Usage**: Check 10router dashboard for usage statistics and costs
3. **Rotate API Keys**: Regularly rotate your API keys for security
4. **Test Models**: Try different models to find the best one for your use case
