const metaLlama = {
  "id": "meta-llama",
  "priority": 70,
  "alias": "meta",
  "display": {
    "name": "Meta Llama",
    "icon": "rocket_launch",
    "color": "#9333EA",
    "textIcon": "ME",
    "website": "https://llama.com",
    "notice": {
      "apiKeyUrl": "https://llama.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.llama.com/compat/v1/chat/completions",
    "validateUrl": "https://api.llama.com/compat/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "Llama-4-Maverick-17B-128E-Instruct-FP8",
      "name": "Llama-4-Maverick-17B-128E-Instruct-FP8"
    },
    {
      "id": "Llama-4-Scout-17B-16E-Instruct-FP8",
      "name": "Llama-4-Scout-17B-16E-Instruct-FP8"
    },
    {
      "id": "Llama-3.3-70B-Instruct",
      "name": "Llama-3.3-70B-Instruct"
    }
  ]
};
export default metaLlama;
