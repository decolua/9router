export default {
  "id": "liquid",
  "priority": 70,
  "alias": "liquid",
  "display": {
    "name": "Liquid",
    "icon": "diamond",
    "color": "#0891B2",
    "textIcon": "LI",
    "website": "https://liquid.ai",
    "notice": {
      "apiKeyUrl": "https://liquid.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.liquid.ai/v1/chat/completions",
    "validateUrl": "https://api.liquid.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "liquid-lfm-40b",
      "name": "Liquid LFM 40B"
    }
  ]
};
