export default {
  "id": "wandb",
  "priority": 70,
  "alias": "wandb",
  "display": {
    "name": "Weights & Biases",
    "icon": "water_drop",
    "color": "#7C3AED",
    "textIcon": "WE",
    "website": "https://inference.wandb.ai",
    "notice": {
      "apiKeyUrl": "https://inference.wandb.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.inference.wandb.ai/v1/chat/completions",
    "validateUrl": "https://api.inference.wandb.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "openai/gpt-oss-120b",
      "name": "openai/gpt-oss-120b"
    },
    {
      "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
      "name": "Qwen/Qwen3-Coder-480B-A35B-Instruct"
    },
    {
      "id": "deepseek-ai/DeepSeek-V3.1",
      "name": "deepseek-ai/DeepSeek-V3.1"
    }
  ]
};
