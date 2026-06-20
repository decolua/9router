export default {
  "id": "ollama-cloud",
  "priority": 70,
  "alias": "ollamacloud",
  "display": {
    "name": "Ollama Cloud",
    "icon": "water_drop",
    "color": "#FF6B35",
    "textIcon": "OL",
    "website": "https://ollama.com",
    "notice": {
      "apiKeyUrl": "https://ollama.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://ollama.com/v1/chat/completions",
    "validateUrl": "https://ollama.com/api/tags",
    "quirks": {}
  },
  "passthroughModels": true,
  "models": [
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
      "id": "kimi-k2.6",
      "name": "Kimi K2.6"
    },
    {
      "id": "glm-5.1",
      "name": "GLM 5.1"
    },
    {
      "id": "minimax-m3",
      "name": "MiniMax M3",
      "contextLength": 1048576,
      "supportsVision": true
    },
    {
      "id": "minimax-m2.7",
      "name": "MiniMax M2.7"
    },
    {
      "id": "gemma4:31b",
      "name": "Gemma 4 31B"
    },
    {
      "id": "nemotron-3-super",
      "name": "NVIDIA Nemotron 3 Super"
    },
    {
      "id": "qwen3.5:397b",
      "name": "Qwen 3.5 397B"
    }
  ]
};
