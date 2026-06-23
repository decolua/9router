const nousResearch = {
  "id": "nous-research",
  "priority": 70,
  "alias": "nous",
  "display": {
    "name": "Nous Research",
    "icon": "code",
    "color": "#D97757",
    "textIcon": "NO",
    "website": "https://inference-api.nousresearch.com",
    "notice": {
      "apiKeyUrl": "https://inference-api.nousresearch.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://inference-api.nousresearch.com/v1/chat/completions",
    "validateUrl": "https://inference-api.nousresearch.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "Hermes-4-405B",
      "name": "Hermes 4 7B (Nous Research)"
    },
    {
      "id": "Hermes-4-70B",
      "name": "Hermes 4 70B (Nous Research)"
    }
  ]
};
export default nousResearch;
