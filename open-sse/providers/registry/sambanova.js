export default {
  "id": "sambanova",
  "priority": 70,
  "alias": "samba",
  "display": {
    "name": "SambaNova",
    "icon": "bolt",
    "color": "#DC2626",
    "textIcon": "SA",
    "website": "https://sambanova.ai",
    "notice": {
      "apiKeyUrl": "https://sambanova.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.sambanova.ai/v1/chat/completions",
    "validateUrl": "https://api.sambanova.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "MiniMax-M2.7",
      "name": "MiniMax-M2.7"
    },
    {
      "id": "DeepSeek-V3.2",
      "name": "DeepSeek-V3.2"
    },
    {
      "id": "Llama-4-Maverick-17B-128E-Instruct",
      "name": "Llama-4-Maverick-17B-128E-Instruct"
    },
    {
      "id": "Meta-Llama-3.3-70B-Instruct",
      "name": "Meta-Llama-3.3-70B-Instruct"
    },
    {
      "id": "gpt-oss-120b",
      "name": "gpt-oss-120b"
    }
  ]
};
