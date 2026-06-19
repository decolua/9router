export default {
  "id": "stepfun",
  "priority": 70,
  "alias": "stepfun",
  "display": {
    "name": "StepFun",
    "icon": "bolt",
    "color": "#9333EA",
    "textIcon": "ST",
    "website": "https://stepfun.com",
    "notice": {
      "apiKeyUrl": "https://stepfun.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://api.stepfun.com/v1/chat/completions",
    "validateUrl": "https://api.stepfun.com/v1/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "step-1v",
      "name": "Step 1V"
    }
  ]
};
