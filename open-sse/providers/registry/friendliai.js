export default {
  "id": "friendliai",
  "priority": 70,
  "alias": "friendli",
  "display": {
    "name": "FriendliAI",
    "icon": "code",
    "color": "#0062FF",
    "textIcon": "FR",
    "website": "https://friendli.ai",
    "notice": {
      "apiKeyUrl": "https://friendli.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.friendli.ai/dedicated/v1/chat/completions",
    "validateUrl": "https://api.friendli.ai/dedicated/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "meta-llama-3.1-70b-instruct",
      "name": "meta-llama-3.1-70b-instruct"
    },
    {
      "id": "meta-llama-3.1-8b-instruct",
      "name": "meta-llama-3.1-8b-instruct"
    }
  ]
};
