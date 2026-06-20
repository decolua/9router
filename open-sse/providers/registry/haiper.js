export default {
  "id": "haiper",
  "priority": 70,
  "alias": "hp",
  "display": {
    "name": "Haiper",
    "icon": "smart_toy",
    "color": "#0062FF",
    "textIcon": "HA",
    "website": "https://haiper.ai",
    "notice": {
      "apiKeyUrl": "https://haiper.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.haiper.ai/v1",
    "validateUrl": "https://api.haiper.ai/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "gen2",
      "name": "Gen 2 Video"
    },
    {
      "id": "gen2-image",
      "name": "Gen 2 Image"
    }
  ]
};
