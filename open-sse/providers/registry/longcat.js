export default {
  "id": "longcat",
  "priority": 70,
  "alias": "lc",
  "display": {
    "name": "LongCat",
    "icon": "diamond",
    "color": "#DC2626",
    "textIcon": "LO",
    "website": "https://longcat.chat",
    "notice": {
      "apiKeyUrl": "https://longcat.chat"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.longcat.chat/openai/v1/chat/completions",
    "validateUrl": "https://api.longcat.chat/openai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "LongCat-Flash-Lite",
      "name": "LongCat Flash-Lite (50M tok/day 🆓)"
    },
    {
      "id": "LongCat-Flash-Chat",
      "name": "LongCat Flash-Chat (500K tok/day 🆓)"
    },
    {
      "id": "LongCat-Flash-Thinking",
      "name": "LongCat Flash-Thinking (500K tok/day 🆓)"
    },
    {
      "id": "LongCat-Flash-Omni-2603",
      "name": "LongCat Flash-Omni-2603 (500K tok/day 🆓)"
    }
  ]
};
