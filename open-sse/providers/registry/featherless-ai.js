const featherlessAi = {
  "id": "featherless-ai",
  "priority": 70,
  "alias": "featherless",
  "display": {
    "name": "Featherless",
    "icon": "code",
    "color": "#0062FF",
    "textIcon": "FE",
    "website": "https://featherless.ai",
    "notice": {
      "apiKeyUrl": "https://featherless.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.featherless.ai/v1/chat/completions",
    "validateUrl": "https://api.featherless.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "featherless-ai/Qwerky-72B",
      "name": "featherless-ai/Qwerky-72B"
    },
    {
      "id": "featherless-ai/Qwerky-QwQ-32B",
      "name": "featherless-ai/Qwerky-QwQ-32B"
    }
  ]
};
export default featherlessAi;
