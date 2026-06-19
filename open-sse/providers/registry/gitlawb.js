export default {
  "id": "gitlawb",
  "priority": 70,
  "alias": "glb",
  "display": {
    "name": "GitLawB",
    "icon": "water_drop",
    "color": "#7C3AED",
    "textIcon": "GI",
    "website": "https://opengateway.gitlawb.com",
    "notice": {
      "apiKeyUrl": "https://opengateway.gitlawb.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://opengateway.gitlawb.com/v1/xiaomi-mimo",
    "validateUrl": "https://opengateway.gitlawb.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "mimo-v2.5-pro",
      "name": "MiMo-V2.5-Pro",
      "contextLength": 1048576,
      "maxOutputTokens": 131072
    },
    {
      "id": "mimo-v2.5",
      "name": "MiMo-V2.5",
      "contextLength": 1048576,
      "maxOutputTokens": 131072
    },
    {
      "id": "mimo-v2-pro",
      "name": "MiMo-V2-Pro",
      "contextLength": 262144,
      "maxOutputTokens": 131072
    },
    {
      "id": "mimo-v2-omni",
      "name": "MiMo-V2-Omni",
      "contextLength": 262144,
      "maxOutputTokens": 131072
    },
    {
      "id": "mimo-v2-flash",
      "name": "MiMo-V2-Flash",
      "contextLength": 262144,
      "maxOutputTokens": 65536
    }
  ]
};
