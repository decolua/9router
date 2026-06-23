const yi = {
  "id": "yi",
  "priority": 70,
  "alias": "yi",
  "display": {
    "name": "Yi",
    "icon": "memory",
    "color": "#DC2626",
    "textIcon": "YI",
    "website": "https://lingyiwanwu.com",
    "notice": {
      "apiKeyUrl": "https://lingyiwanwu.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.lingyiwanwu.com/v1/chat/completions",
    "validateUrl": "https://api.lingyiwanwu.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "yi-large",
      "name": "Yi Large"
    }
  ]
};
export default yi;
