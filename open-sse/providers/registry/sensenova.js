const sensenova = {
  "id": "sensenova",
  "priority": 70,
  "alias": "sensenova",
  "display": {
    "name": "SenseNova",
    "icon": "bolt",
    "color": "#DC2626",
    "textIcon": "SE",
    "website": "https://sensenova.cn",
    "notice": {
      "apiKeyUrl": "https://sensenova.cn"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.sensenova.cn/v1/chat/completions",
    "validateUrl": "https://api.sensenova.cn/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "sensechat",
      "name": "SenseChat"
    }
  ]
};
export default sensenova;
