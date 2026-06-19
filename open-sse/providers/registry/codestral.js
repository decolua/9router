export default {
  "id": "codestral",
  "priority": 70,
  "alias": "codestral",
  "display": {
    "name": "Codestral",
    "icon": "bolt",
    "color": "#059669",
    "textIcon": "CO",
    "website": "https://codestral.mistral.ai",
    "notice": {
      "apiKeyUrl": "https://codestral.mistral.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://codestral.mistral.ai/v1/chat/completions",
    "validateUrl": "https://codestral.mistral.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "codestral-2405",
      "name": "codestral-2405"
    },
    {
      "id": "codestral-latest",
      "name": "codestral-latest"
    }
  ]
};
