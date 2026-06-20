export default {
  "id": "publicai",
  "priority": 70,
  "alias": "publicai",
  "display": {
    "name": "PublicAI",
    "icon": "smart_toy",
    "color": "#9333EA",
    "textIcon": "PU",
    "website": "https://publicai.co",
    "notice": {
      "apiKeyUrl": "https://publicai.co"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.publicai.co/v1/chat/completions",
    "validateUrl": "https://api.publicai.co/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "swiss-ai/apertus-70b-instruct",
      "name": "swiss-ai/apertus-70b-instruct"
    },
    {
      "id": "aisingapore/Qwen-SEA-LION-v4-32B-IT",
      "name": "aisingapore/Qwen-SEA-LION-v4-32B-IT"
    },
    {
      "id": "allenai/Olmo-3-32B-Think",
      "name": "allenai/Olmo-3-32B-Think"
    }
  ]
};
