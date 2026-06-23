const v0Vercel = {
  "id": "v0-vercel",
  "priority": 70,
  "alias": "v0",
  "display": {
    "name": "v0 (Vercel)",
    "icon": "code",
    "color": "#0891B2",
    "textIcon": "V0",
    "website": "https://v0.dev",
    "notice": {
      "apiKeyUrl": "https://v0.dev"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.v0.dev/v1/chat/completions",
    "validateUrl": "https://api.v0.dev/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "v0-1.0-md",
      "name": "v0-1.0-md"
    },
    {
      "id": "v0-1.5-lg",
      "name": "v0-1.5-lg"
    },
    {
      "id": "v0-1.5-md",
      "name": "v0-1.5-md"
    }
  ]
};
export default v0Vercel;
