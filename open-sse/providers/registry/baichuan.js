export default {
  "id": "baichuan",
  "priority": 70,
  "alias": "baichuan",
  "display": {
    "name": "Baichuan",
    "icon": "hub",
    "color": "#9333EA",
    "textIcon": "BA",
    "website": "https://baichuan-ai.com",
    "notice": {
      "apiKeyUrl": "https://baichuan-ai.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.baichuan-ai.com/v1/chat/completions",
    "validateUrl": "https://api.baichuan-ai.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "Baichuan4",
      "name": "Baichuan 4"
    }
  ]
};
