const udio = {
  "id": "udio",
  "priority": 70,
  "alias": "udio",
  "display": {
    "name": "Udio",
    "icon": "rocket_launch",
    "color": "#0062FF",
    "textIcon": "UD",
    "website": "https://www.udio.com",
    "notice": {
      "apiKeyUrl": "https://www.udio.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://www.udio.com/api/generate-proxy",
    "validateUrl": "https://www.udio.com/api/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "udio-default",
      "name": "Udio Default"
    }
  ]
};
export default udio;
