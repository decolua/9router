const predibase = {
  "id": "predibase",
  "priority": 70,
  "alias": "predibase",
  "display": {
    "name": "Predibase",
    "icon": "smart_toy",
    "color": "#2563EB",
    "textIcon": "PR",
    "website": "https://serving.app.predibase.com",
    "notice": {
      "apiKeyUrl": "https://serving.app.predibase.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://serving.app.predibase.com/v1/chat/completions",
    "validateUrl": "https://serving.app.predibase.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "llama-3.3-70b",
      "name": "llama-3.3-70b"
    }
  ]
};
export default predibase;
