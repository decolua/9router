export default {
  "id": "api-airforce",
  "priority": 70,
  "alias": "af",
  "display": {
    "name": "API Airforce",
    "icon": "memory",
    "color": "#FF6B35",
    "textIcon": "AP",
    "website": "https://airforce",
    "notice": {
      "apiKeyUrl": "https://airforce"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.airforce/v1/chat/completions",
    "validateUrl": "https://api.airforce/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "x-ai/grok-3",
      "name": "Grok-3 (Free)",
      "contextLength": 131072,
      "maxOutputTokens": 65536
    },
    {
      "id": "x-ai/grok-2-1212",
      "name": "Grok-2 1212 (Free)",
      "contextLength": 131072,
      "maxOutputTokens": 65536
    },
    {
      "id": "anthropic/claude-3.7-sonnet",
      "name": "Claude 3.7 Sonnet (Free)",
      "contextLength": 200000,
      "maxOutputTokens": 8192
    },
    {
      "id": "qwen/qwen3-32b",
      "name": "Qwen3 32B (Free)",
      "contextLength": 128000,
      "maxOutputTokens": 8192
    },
    {
      "id": "moonshot/kimi-k2.6",
      "name": "Kimi K2.6 (Free)",
      "contextLength": 262144,
      "maxOutputTokens": 65536
    },
    {
      "id": "google/gemini-2.5-flash",
      "name": "Gemini 2.5 Flash (Free)",
      "contextLength": 1048576,
      "maxOutputTokens": 65536
    },
    {
      "id": "deepseek/deepseek-v3",
      "name": "DeepSeek V3 (Free)",
      "contextLength": 262144,
      "maxOutputTokens": 16384
    }
  ]
};
