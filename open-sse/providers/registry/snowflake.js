export default {
  "id": "snowflake",
  "priority": 70,
  "alias": "snowflake",
  "display": {
    "name": "Snowflake",
    "icon": "bolt",
    "color": "#DC2626",
    "textIcon": "SN",
    "website": "https://{account}.snowflakecomputing.com",
    "notice": {
      "apiKeyUrl": "https://{account}.snowflakecomputing.com"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://{account}.snowflakecomputing.com/api/v2",
    "validateUrl": "https://{account}.snowflakecomputing.com/api/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "llama3.1-70b",
      "name": "llama3.1-70b"
    },
    {
      "id": "llama3.3-70b",
      "name": "llama3.3-70b"
    },
    {
      "id": "deepseek-r1",
      "name": "deepseek-r1"
    },
    {
      "id": "claude-3-5-sonnet",
      "name": "claude-3-5-sonnet"
    }
  ]
};
