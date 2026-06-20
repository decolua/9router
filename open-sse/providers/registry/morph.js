export default {
  "id": "morph",
  "priority": 70,
  "alias": "morph",
  "display": {
    "name": "Morph",
    "icon": "rocket_launch",
    "color": "#5B5FEF",
    "textIcon": "MO",
    "website": "https://morphllm.com",
    "notice": {
      "apiKeyUrl": "https://morphllm.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.morphllm.com/v1/chat/completions",
    "validateUrl": "https://api.morphllm.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "morph-v3-large",
      "name": "morph-v3-large"
    },
    {
      "id": "morph-v3-fast",
      "name": "morph-v3-fast"
    }
  ]
};
