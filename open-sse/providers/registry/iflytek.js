export default {
  "id": "iflytek",
  "priority": 70,
  "alias": "iflytek",
  "display": {
    "name": "iFlyTek",
    "icon": "memory",
    "color": "#0891B2",
    "textIcon": "IF",
    "website": "https://spark-api.xf-yun.com",
    "notice": {
      "apiKeyUrl": "https://spark-api.xf-yun.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://spark-api.xf-yun.com/v1/chat/completions",
    "validateUrl": "https://spark-api.xf-yun.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "generalv3.5",
      "name": "General V3.5"
    }
  ]
};
