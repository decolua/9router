export default {
  "id": "novita",
  "priority": 70,
  "alias": "novita",
  "display": {
    "name": "Novita",
    "icon": "code",
    "color": "#D97757",
    "textIcon": "NO",
    "website": "https://novita.ai",
    "notice": {
      "apiKeyUrl": "https://novita.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.novita.ai/v3/chat/completions",
    "validateUrl": "https://api.novita.ai/v3/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "ai-ai/llama-3.1-8b-instruct",
      "name": "Llama 3.1 8B"
    }
  ]
};
