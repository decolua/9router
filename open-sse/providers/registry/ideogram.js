export default {
  "id": "ideogram",
  "priority": 70,
  "alias": "ideo",
  "display": {
    "name": "Ideogram",
    "icon": "memory",
    "color": "#FF6B35",
    "textIcon": "ID",
    "website": "https://ideogram.ai",
    "notice": {
      "apiKeyUrl": "https://ideogram.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.ideogram.ai",
    "validateUrl": "https://api.ideogram.ai/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "V_3",
      "name": "Ideogram V3"
    },
    {
      "id": "V_2A",
      "name": "Ideogram V2A"
    }
  ]
};
