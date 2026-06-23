const bytez = {
  "id": "bytez",
  "priority": 70,
  "alias": "bytez",
  "display": {
    "name": "Bytez",
    "icon": "hub",
    "color": "#0891B2",
    "textIcon": "BY",
    "website": "https://bytez.com",
    "notice": {
      "apiKeyUrl": "https://bytez.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.bytez.com/models/v2",
    "validateUrl": "https://api.bytez.com/models/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "meta-llama/Llama-3.3-70B-Instruct",
      "name": "meta-llama/Llama-3.3-70B-Instruct"
    },
    {
      "id": "mistralai/Mistral-7B-Instruct-v0.3",
      "name": "mistralai/Mistral-7B-Instruct-v0.3"
    },
    {
      "id": "Qwen/Qwen2.5-72B-Instruct",
      "name": "Qwen/Qwen2.5-72B-Instruct"
    }
  ]
};
export default bytez;
