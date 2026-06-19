export default {
  "id": "leonardo",
  "priority": 70,
  "alias": "leo",
  "display": {
    "name": "Leonardo",
    "icon": "diamond",
    "color": "#7C3AED",
    "textIcon": "LE",
    "website": "https://cloud.leonardo.ai",
    "notice": {
      "apiKeyUrl": "https://cloud.leonardo.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://cloud.leonardo.ai/api/rest/v1",
    "validateUrl": "https://cloud.leonardo.ai/api/rest/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "phoenix",
      "name": "Phoenix"
    },
    {
      "id": "sdxl",
      "name": "SDXL"
    }
  ]
};
