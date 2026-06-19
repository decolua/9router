export default {
  "id": "monsterapi",
  "priority": 70,
  "alias": "monster",
  "display": {
    "name": "MonsterAPI",
    "icon": "rocket_launch",
    "color": "#5B5FEF",
    "textIcon": "MO",
    "website": "https://monsterapi.ai",
    "notice": {
      "apiKeyUrl": "https://monsterapi.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.monsterapi.ai/v1/chat/completions",
    "validateUrl": "https://api.monsterapi.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "llama-3-8b-fuse",
      "name": "Llama 3 8B Fuse"
    }
  ]
};
