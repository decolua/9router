export default {
  "id": "doubao",
  "priority": 70,
  "alias": "doubao",
  "display": {
    "name": "Doubao",
    "icon": "diamond",
    "color": "#7C3AED",
    "textIcon": "DO",
    "website": "https://ark.cn-beijing.volces.com",
    "notice": {
      "apiKeyUrl": "https://ark.cn-beijing.volces.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "validateUrl": "https://ark.cn-beijing.volces.com/api/v3/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "doubao-pro-32k",
      "name": "Doubao Pro 32K"
    }
  ]
};
