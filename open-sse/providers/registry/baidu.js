export default {
  "id": "baidu",
  "priority": 70,
  "alias": "baidu",
  "display": {
    "name": "Baidu",
    "icon": "hub",
    "color": "#D97757",
    "textIcon": "BA",
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
      "id": "ernie-4.0-8k",
      "name": "ERNIE 4.0 8K"
    }
  ]
};
