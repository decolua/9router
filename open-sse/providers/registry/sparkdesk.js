const sparkdesk = {
  "id": "sparkdesk",
  "priority": 70,
  "alias": "sparkdesk",
  "display": {
    "name": "SparkDesk",
    "icon": "bolt",
    "color": "#7C3AED",
    "textIcon": "SP",
    "website": "https://spark-api.xf-yun.com",
    "notice": {
      "apiKeyUrl": "https://spark-api.xf-yun.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://spark-api.xf-yun.com/v3.1/chat/completions",
    "validateUrl": "https://spark-api.xf-yun.com/v3.1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "general",
      "name": "General"
    }
  ]
};
export default sparkdesk;
