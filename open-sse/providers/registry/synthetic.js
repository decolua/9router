export default {
  "id": "synthetic",
  "priority": 70,
  "alias": "synthetic",
  "display": {
    "name": "Synthetic",
    "icon": "bolt",
    "color": "#D97757",
    "textIcon": "SY",
    "website": "https://synthetic.new",
    "notice": {
      "apiKeyUrl": "https://synthetic.new"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.synthetic.new/openai/v1/chat/completions",
    "validateUrl": "https://api.synthetic.new/openai/v1/models",
    "quirks": {}
  },
  "passthroughModels": true,
  "models": [
    {
      "id": "hf:nvidia/Kimi-K2.5-NVFP4",
      "name": "Kimi K2.5 (NVFP4)"
    },
    {
      "id": "hf:MiniMaxAI/MiniMax-M2.5",
      "name": "MiniMax M2.5"
    },
    {
      "id": "hf:zai-org/GLM-4.7-Flash",
      "name": "GLM 4.7 Flash"
    },
    {
      "id": "hf:zai-org/GLM-4.7",
      "name": "GLM 4.7"
    },
    {
      "id": "hf:moonshotai/Kimi-K2.5",
      "name": "Kimi K2.5"
    },
    {
      "id": "hf:deepseek-ai/DeepSeek-V3.2",
      "name": "DeepSeek V3.2"
    }
  ]
};
