const kluster = {
  "id": "kluster",
  "priority": 70,
  "alias": "kluster",
  "display": {
    "name": "Kluster",
    "icon": "bolt",
    "color": "#DC2626",
    "textIcon": "KL",
    "website": "https://kluster.ai",
    "notice": {
      "apiKeyUrl": "https://kluster.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.kluster.ai/v1/chat/completions",
    "validateUrl": "https://api.kluster.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "auto",
      "name": "Auto"
    }
  ]
};
export default kluster;
