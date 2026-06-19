export default {
  "id": "dify",
  "priority": 70,
  "alias": "dify",
  "display": {
    "name": "Dify",
    "icon": "diamond",
    "color": "#0891B2",
    "textIcon": "DI",
    "website": "https://dify.ai",
    "notice": {
      "apiKeyUrl": "https://dify.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.dify.ai/v1/chat/completions",
    "validateUrl": "https://api.dify.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "auto",
      "name": "Auto"
    }
  ]
};
