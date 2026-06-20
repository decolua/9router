export default {
  "id": "nlpcloud",
  "priority": 70,
  "alias": "nlpc",
  "display": {
    "name": "NLPCloud",
    "icon": "code",
    "color": "#0062FF",
    "textIcon": "NL",
    "website": "https://nlpcloud.io",
    "notice": {
      "apiKeyUrl": "https://nlpcloud.io"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.nlpcloud.io/v1/chat/completions",
    "validateUrl": "https://api.nlpcloud.io/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "llama-3-8b-instruct",
      "name": "Llama 3 8B"
    }
  ]
};
