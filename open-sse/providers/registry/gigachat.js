export default {
  "id": "gigachat",
  "priority": 70,
  "alias": "gigachat",
  "display": {
    "name": "GigaChat",
    "icon": "water_drop",
    "color": "#FF6B35",
    "textIcon": "GI",
    "website": "https://gigachat.devices.sberbank.ru",
    "notice": {
      "apiKeyUrl": "https://gigachat.devices.sberbank.ru"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://gigachat.devices.sberbank.ru/api/v1",
    "validateUrl": "https://gigachat.devices.sberbank.ru/api/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "GigaChat-2-Max",
      "name": "GigaChat-2-Max"
    },
    {
      "id": "GigaChat-2-Pro",
      "name": "GigaChat-2-Pro"
    },
    {
      "id": "GigaChat-2-Lite",
      "name": "GigaChat-2-Lite"
    }
  ]
};
