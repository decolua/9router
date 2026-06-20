export default {
  "id": "inclusionai",
  "priority": 70,
  "alias": "inclusionai",
  "display": {
    "name": "InclusionAI",
    "icon": "memory",
    "color": "#5B5FEF",
    "textIcon": "IN",
    "website": "https://inclusionai.tech",
    "notice": {
      "apiKeyUrl": "https://inclusionai.tech"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.inclusionai.tech/v1/chat/completions",
    "validateUrl": "https://api.inclusionai.tech/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "inclusion-model",
      "name": "Inclusion Model"
    }
  ]
};
