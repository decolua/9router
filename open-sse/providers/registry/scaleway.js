const scaleway = {
  "id": "scaleway",
  "priority": 70,
  "alias": "scw",
  "display": {
    "name": "Scaleway",
    "icon": "bolt",
    "color": "#059669",
    "textIcon": "SC",
    "website": "https://scaleway.ai",
    "notice": {
      "apiKeyUrl": "https://scaleway.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.scaleway.ai/v1/chat/completions",
    "validateUrl": "https://api.scaleway.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "qwen3-235b-a22b-instruct-2507",
      "name": "Qwen3 235B A22B (1M free tok 🆓)"
    },
    {
      "id": "llama-3.1-70b-instruct",
      "name": "Llama 3.1 70B (🆓 EU)"
    },
    {
      "id": "llama-3.1-8b-instruct",
      "name": "Llama 3.1 8B (🆓 EU)"
    },
    {
      "id": "mistral-small-3.2-24b-instruct-2506",
      "name": "Mistral Small 3.2 (🆓 EU)"
    },
    {
      "id": "deepseek-v3-0324",
      "name": "DeepSeek V3 (🆓 EU)"
    },
    {
      "id": "gpt-oss-120b",
      "name": "GPT-OSS 120B (🆓 EU)"
    }
  ]
};
export default scaleway;
