export default {
  "id": "venice",
  "priority": 70,
  "alias": "venice",
  "display": {
    "name": "Venice",
    "icon": "code",
    "color": "#7C3AED",
    "textIcon": "VE",
    "website": "https://venice.ai",
    "notice": {
      "apiKeyUrl": "https://venice.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.venice.ai/api/v1/chat/completions",
    "validateUrl": "https://api.venice.ai/api/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "venice-latest",
      "name": "venice-latest"
    }
  ]
};
