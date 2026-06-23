const tencent = {
  "id": "tencent",
  "priority": 70,
  "alias": "tencent",
  "display": {
    "name": "Tencent",
    "icon": "diamond",
    "color": "#9333EA",
    "textIcon": "TE",
    "website": "https://hunyuan.cloud.tencent.com",
    "notice": {
      "apiKeyUrl": "https://hunyuan.cloud.tencent.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    "validateUrl": "https://api.hunyuan.cloud.tencent.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "hunyuan-pro",
      "name": "Hunyuan Pro"
    }
  ]
};
export default tencent;
