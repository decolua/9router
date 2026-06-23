const nanogpt = {
  "id": "nanogpt",
  "priority": 70,
  "alias": "nanogpt",
  "display": {
    "name": "NanoGPT",
    "icon": "code",
    "color": "#2563EB",
    "textIcon": "NA",
    "website": "https://nano-gpt.com",
    "notice": {
      "apiKeyUrl": "https://nano-gpt.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://nano-gpt.com/api/v1/chat/completions",
    "validateUrl": "https://nano-gpt.com/api/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "chatgpt-4o-latest",
      "name": "chatgpt-4o-latest"
    },
    {
      "id": "claude-3.5-sonnet",
      "name": "claude-3.5-sonnet"
    },
    {
      "id": "gpt-4o-mini",
      "name": "gpt-4o-mini"
    }
  ]
};
export default nanogpt;
