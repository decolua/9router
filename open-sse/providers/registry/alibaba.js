export default {
  "id": "alibaba",
  "priority": 70,
  "alias": "ali",
  "display": {
    "name": "Alibaba",
    "icon": "memory",
    "color": "#5B5FEF",
    "textIcon": "AL",
    "website": "https://dashscope-intl.aliyuncs.com",
    "notice": {
      "apiKeyUrl": "https://dashscope-intl.aliyuncs.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    "validateUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    "quirks": {}
  },
  "passthroughModels": true,
  "models": [
    {
      "id": "qwen-max",
      "name": "Qwen Max"
    },
    {
      "id": "qwen-max-2025-01-25",
      "name": "Qwen Max (2025-01-25)"
    },
    {
      "id": "qwen-plus",
      "name": "Qwen Plus"
    },
    {
      "id": "qwen-plus-2025-07-14",
      "name": "Qwen Plus (2025-07-14)"
    },
    {
      "id": "qwen-turbo",
      "name": "Qwen Turbo"
    },
    {
      "id": "qwen-turbo-2025-11-01",
      "name": "Qwen Turbo (2025-11-01)"
    },
    {
      "id": "qwen3-coder-plus",
      "name": "Qwen3 Coder Plus"
    },
    {
      "id": "qwen3-coder-flash",
      "name": "Qwen3 Coder Flash"
    },
    {
      "id": "qwq-plus",
      "name": "QwQ Plus (Reasoning)"
    },
    {
      "id": "qwq-32b",
      "name": "QwQ 32B"
    },
    {
      "id": "qwen3-32b",
      "name": "Qwen3 32B"
    },
    {
      "id": "qwen3-235b-a22b",
      "name": "Qwen3 235B A22B"
    }
  ]
};
