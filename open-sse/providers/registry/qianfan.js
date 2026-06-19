export default {
  "id": "qianfan",
  "priority": 70,
  "alias": "qianfan",
  "display": {
    "name": "QianFan",
    "icon": "memory",
    "color": "#5B5FEF",
    "textIcon": "QI",
    "website": "https://qianfan.baidubce.com",
    "notice": {
      "apiKeyUrl": "https://qianfan.baidubce.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://qianfan.baidubce.com/v2/chat/completions",
    "validateUrl": "https://qianfan.baidubce.com/v2/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "ernie-5.1",
      "name": "ERNIE 5.1"
    },
    {
      "id": "ernie-5.0-thinking-latest",
      "name": "ERNIE 5.0 Thinking Latest"
    },
    {
      "id": "ernie-x1.1",
      "name": "ERNIE X1.1",
      "contextLength": 64000
    }
  ]
};
