export default {
  "id": "modal",
  "priority": 70,
  "alias": "modal",
  "display": {
    "name": "Modal",
    "icon": "rocket_launch",
    "color": "#059669",
    "textIcon": "MO",
    "website": "https://modal.ai",
    "notice": {
      "apiKeyUrl": "https://modal.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.modal.ai/v1/chat/completions",
    "validateUrl": "https://api.modal.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "google/gemini-2.0-flash",
      "name": "Gemini 2.0 Flash"
    }
  ]
};
