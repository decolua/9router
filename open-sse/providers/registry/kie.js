const kie = {
  "id": "kie",
  "priority": 70,
  "alias": "kie",
  "display": {
    "name": "Kie",
    "icon": "bolt",
    "color": "#0062FF",
    "textIcon": "KI",
    "website": "https://kie.ai",
    "notice": {
      "apiKeyUrl": "https://kie.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.kie.ai/v1/chat/completions",
    "validateUrl": "https://api.kie.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "claude-opus-4-7",
      "name": "Claude 4.7 Opus"
    },
    {
      "id": "claude-sonnet-4-6",
      "name": "Claude 4.6 Sonnet"
    },
    {
      "id": "claude-haiku-4-5",
      "name": "Claude 4.5 Haiku"
    },
    {
      "id": "gpt-5-5",
      "name": "GPT 5.5"
    },
    {
      "id": "gpt-5-4",
      "name": "GPT 5.4"
    },
    {
      "id": "gpt-5-2",
      "name": "GPT 5.2"
    },
    {
      "id": "gemini-3-1-pro",
      "name": "Gemini 3.1 Pro"
    },
    {
      "id": "gemini-2-5-pro",
      "name": "Gemini 2.5 Pro"
    },
    {
      "id": "gemini-3-flash",
      "name": "Gemini 3 Flash"
    }
  ]
};
export default kie;
