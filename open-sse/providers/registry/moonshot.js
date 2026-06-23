const moonshot = {
  "id": "moonshot",
  "priority": 70,
  "alias": "moonshot",
  "display": {
    "name": "Moonshot",
    "icon": "rocket_launch",
    "color": "#2563EB",
    "textIcon": "MO",
    "website": "https://moonshot.ai",
    "notice": {
      "apiKeyUrl": "https://moonshot.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.moonshot.ai/v1/chat/completions",
    "validateUrl": "https://api.moonshot.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "kimi-k2.6",
      "name": "kimi-k2.6"
    },
    {
      "id": "kimi-k2.5",
      "name": "kimi-k2.5"
    },
    {
      "id": "kimi-k2.7-code",
      "name": "Kimi K2.7 Code",
      "contextLength": 262144,
      "maxOutputTokens": 262144,
      "supportsVision": true,
      "supportsReasoning": true,
      "unsupportedParams": [
        "temperature",
        "top_p"
      ]
    },
    {
      "id": "kimi-k2.7-code-highspeed",
      "name": "Kimi K2.7 Code (High Speed)",
      "contextLength": 262144,
      "maxOutputTokens": 262144,
      "supportsVision": true,
      "supportsReasoning": true,
      "unsupportedParams": [
        "temperature",
        "top_p"
      ]
    }
  ]
};
export default moonshot;
