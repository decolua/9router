const llm7 = {
  "id": "llm7",
  "priority": 70,
  "alias": "llm7",
  "display": {
    "name": "LLM7",
    "icon": "diamond",
    "color": "#5B5FEF",
    "textIcon": "LL",
    "website": "https://llm7.io",
    "notice": {
      "apiKeyUrl": "https://llm7.io"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.llm7.io/v1/chat/completions",
    "validateUrl": "https://api.llm7.io/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "gpt-4o-mini-2024-07-18",
      "name": "GPT-4o mini (LLM7)"
    },
    {
      "id": "gpt-4.1-nano-2025-04-14",
      "name": "GPT-4.1 nano (LLM7)"
    },
    {
      "id": "deepseek-r1-0528",
      "name": "DeepSeek R1 (LLM7)"
    },
    {
      "id": "qwen2.5-coder-32b-instruct",
      "name": "Qwen2.5 Coder 32B (LLM7)"
    }
  ]
};
export default llm7;
