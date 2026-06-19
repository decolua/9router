export default {
  "id": "upstage",
  "priority": 70,
  "alias": "upstage",
  "display": {
    "name": "Upstage",
    "icon": "rocket_launch",
    "color": "#D97757",
    "textIcon": "UP",
    "website": "https://upstage.ai",
    "notice": {
      "apiKeyUrl": "https://upstage.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.upstage.ai/v1/chat/completions",
    "validateUrl": "https://api.upstage.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "solar-pro3",
      "name": "solar-pro3"
    },
    {
      "id": "solar-mini",
      "name": "solar-mini"
    }
  ]
};
