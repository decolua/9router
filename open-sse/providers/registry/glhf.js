const glhf = {
  "id": "glhf",
  "priority": 70,
  "alias": "glhf",
  "display": {
    "name": "GLHF",
    "icon": "water_drop",
    "color": "#D97757",
    "textIcon": "GL",
    "website": "https://laf.run",
    "notice": {
      "apiKeyUrl": "https://laf.run"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.laf.run/v1/chat/completions",
    "validateUrl": "https://api.laf.run/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "deepseek-7b-chat",
      "name": "DeepSeek 7B Chat"
    }
  ]
};
export default glhf;
