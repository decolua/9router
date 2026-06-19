export default {
  "id": "reka",
  "priority": 70,
  "alias": "reka",
  "display": {
    "name": "Reka",
    "icon": "hub",
    "color": "#9333EA",
    "textIcon": "RE",
    "website": "https://reka.ai",
    "notice": {
      "apiKeyUrl": "https://reka.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.reka.ai/v1/chat/completions",
    "validateUrl": "https://api.reka.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "reka-flash-3",
      "name": "Reka Flash 3"
    },
    {
      "id": "reka-edge-2603",
      "name": "Reka Edge 2603"
    }
  ]
};
