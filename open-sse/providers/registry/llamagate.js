const llamagate = {
  "id": "llamagate",
  "priority": 70,
  "alias": "llamagate",
  "display": {
    "name": "LLMAGate",
    "icon": "diamond",
    "color": "#FF6B35",
    "textIcon": "LL",
    "website": "https://llamagate.ai",
    "notice": {
      "apiKeyUrl": "https://llamagate.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://llamagate.ai/v1/chat/completions",
    "validateUrl": "https://llamagate.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "qwen2.5-coder-7b",
      "name": "qwen2.5-coder-7b"
    },
    {
      "id": "deepseek-coder-6.7b",
      "name": "deepseek-coder-6.7b"
    },
    {
      "id": "qwen3-vl-8b",
      "name": "qwen3-vl-8b"
    }
  ]
};
export default llamagate;
