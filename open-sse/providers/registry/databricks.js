const databricks = {
  "id": "databricks",
  "priority": 70,
  "alias": "databricks",
  "display": {
    "name": "Databricks",
    "icon": "diamond",
    "color": "#FF6B35",
    "textIcon": "DA",
    "website": "https://adb-0000000000000000.0.azuredatabricks.net",
    "notice": {
      "apiKeyUrl": "https://adb-0000000000000000.0.azuredatabricks.net"
    }
  },
  "category": "apikey",
  "transport": {
    "baseUrl": "https://adb-0000000000000000.0.azuredatabricks.net/serving-endpoints",
    "validateUrl": "https://adb-0000000000000000.0.azuredatabricks.net/models",
    "quirks": {}
  },
  "models": [
    {
      "id": "databricks-gpt-5",
      "name": "databricks-gpt-5"
    },
    {
      "id": "databricks-meta-llama-3-3-70b-instruct",
      "name": "databricks-meta-llama-3-3-70b-instruct"
    },
    {
      "id": "databricks-claude-sonnet-4",
      "name": "databricks-claude-sonnet-4"
    },
    {
      "id": "databricks-gemini-2-5-pro",
      "name": "databricks-gemini-2-5-pro"
    }
  ]
};
export default databricks;
