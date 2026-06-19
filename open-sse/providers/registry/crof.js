export default {
  "id": "crof",
  "priority": 70,
  "alias": "crof",
  "display": {
    "name": "Crof",
    "icon": "bolt",
    "color": "#DC2626",
    "textIcon": "CR",
    "website": "https://crof.ai",
    "notice": {
      "apiKeyUrl": "https://crof.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://crof.ai/v1/chat/completions",
    "validateUrl": "https://crof.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "deepseek-v4-pro-precision",
      "name": "DeepSeek V4 Pro (Precision)",
      "supportsReasoning": true
    },
    {
      "id": "deepseek-v4-pro",
      "name": "DeepSeek V4 Pro",
      "supportsReasoning": true
    },
    {
      "id": "deepseek-v4-flash",
      "name": "DeepSeek V4 Flash",
      "supportsReasoning": true
    },
    {
      "id": "deepseek-v3.2",
      "name": "DeepSeek V3.2"
    },
    {
      "id": "kimi-k2.6-precision",
      "name": "Kimi K2.6 (Precision)",
      "supportsReasoning": true
    },
    {
      "id": "kimi-k2.6",
      "name": "Kimi K2.6",
      "supportsReasoning": true
    },
    {
      "id": "kimi-k2.5-lightning",
      "name": "Kimi K2.5 (Lightning)",
      "supportsReasoning": true
    },
    {
      "id": "kimi-k2.5",
      "name": "Kimi K2.5",
      "supportsReasoning": true
    },
    {
      "id": "glm-5.1-precision",
      "name": "GLM 5.1 (Precision)",
      "supportsReasoning": true
    },
    {
      "id": "glm-5.1",
      "name": "GLM 5.1",
      "supportsReasoning": true
    },
    {
      "id": "glm-4.7",
      "name": "GLM 4.7"
    },
    {
      "id": "glm-4.7-flash",
      "name": "GLM 4.7 Flash"
    },
    {
      "id": "mimo-v2.5-pro-precision",
      "name": "Mimo 2.5 Pro (Precision)",
      "supportsReasoning": true
    },
    {
      "id": "mimo-v2.5-pro",
      "name": "Mimo 2.5 Pro",
      "supportsReasoning": true
    },
    {
      "id": "gemma-4-31b-it",
      "name": "Gemma 4 31B",
      "supportsReasoning": true
    },
    {
      "id": "minimax-m2.5",
      "name": "MiniMax M2.5"
    },
    {
      "id": "qwen3.6-27b",
      "name": "Qwen3.6 27B",
      "supportsReasoning": true
    },
    {
      "id": "qwen3.5-397b-a17b",
      "name": "Qwen3.5 397B A17B",
      "supportsReasoning": true
    },
    {
      "id": "qwen3.5-9b",
      "name": "Qwen3.5 9B",
      "supportsReasoning": true
    }
  ]
};
