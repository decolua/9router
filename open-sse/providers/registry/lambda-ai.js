export default {
  "id": "lambda-ai",
  "priority": 70,
  "alias": "lambda",
  "display": {
    "name": "Lambda",
    "icon": "diamond",
    "color": "#5B5FEF",
    "textIcon": "LA",
    "website": "https://lambda.ai",
    "notice": {
      "apiKeyUrl": "https://lambda.ai"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.lambda.ai/v1/chat/completions",
    "validateUrl": "https://api.lambda.ai/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "deepseek-r1-671b",
      "name": "deepseek-r1-671b"
    },
    {
      "id": "llama3.3-70b-instruct-fp8",
      "name": "llama3.3-70b-instruct-fp8"
    },
    {
      "id": "qwen25-coder-32b-instruct",
      "name": "qwen25-coder-32b-instruct"
    }
  ]
};
