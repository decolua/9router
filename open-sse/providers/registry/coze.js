export default {
  "id": "coze",
  "priority": 70,
  "alias": "coze",
  "display": {
    "name": "Coze",
    "icon": "bolt",
    "color": "#0062FF",
    "textIcon": "CO",
    "website": "https://coze.com",
    "notice": {
      "apiKeyUrl": "https://coze.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.coze.com/v1/chat/completions",
    "validateUrl": "https://api.coze.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "claude-3-7-sonnet-20250514",
      "name": "Claude 3.7 Sonnet"
    }
  ]
};
