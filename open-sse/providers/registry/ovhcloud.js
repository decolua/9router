export default {
  "id": "ovhcloud",
  "priority": 70,
  "alias": "ovh",
  "display": {
    "name": "OVHcloud",
    "icon": "water_drop",
    "color": "#FF6B35",
    "textIcon": "OV",
    "website": "https://oai.endpoints.kepler.ai.cloud.ovh.net",
    "notice": {
      "apiKeyUrl": "https://oai.endpoints.kepler.ai.cloud.ovh.net"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    "validateUrl": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "Meta-Llama-3_3-70B-Instruct",
      "name": "Meta-Llama-3_3-70B-Instruct"
    },
    {
      "id": "Qwen2.5-Coder-32B-Instruct",
      "name": "Qwen2.5-Coder-32B-Instruct"
    },
    {
      "id": "Mistral-Small-3.2-24B-Instruct-2506",
      "name": "Mistral-Small-3.2-24B-Instruct-2506"
    }
  ]
};
