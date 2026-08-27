# Continue Integration

Integrate the Continue extension for VS Code / JetBrains with 9Router.

---

## Configuration

Open your Continue `config.json` (`~/.continue/config.json`) and add 9Router as an OpenAI provider:

```json
{
  "models": [
    {
      "title": "9Router - Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-4-7",
      "apiKey": "sk_9router",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Kiro Free Claude",
      "provider": "openai",
      "model": "kr/claude-sonnet-4.5",
      "apiKey": "sk_9router",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```
