const galadriel = {
  "id": "galadriel",
  "priority": 70,
  "alias": "galadriel",
  "display": {
    "name": "Galadriel",
    "icon": "water_drop",
    "color": "#059669",
    "textIcon": "GA",
    "website": "https://galadriel.ai",
    "notice": {
      "apiKeyUrl": "https://galadriel.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.galadriel.ai/v1/chat/completions",
    "validateUrl": "https://api.galadriel.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "galadriel-latest",
      "name": "galadriel-latest"
    }
  ]
};
export default galadriel;
