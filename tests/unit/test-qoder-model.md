# Testing Qoder qmodel_latest Model

## Method 1: Using Node.js Script (Recommended)

### Steps:

1. **Get API Key**
   - Open browser and visit: `http://localhost:20128/dashboard/settings`
   - Copy your API Key from the "API Keys" section
   - Or create a new API Key

2. **Edit Script**
   ```bash
   # Open tests/unit/test-qoder-model.js
   # Modify the API_KEY on line 13
   const API_KEY = "your-api-key-here"; # Replace with your actual API Key
   ```

3. **Run Test**
   ```bash
   node tests/unit/test-qoder-model.js
   ```

### Expected Output:
```
🚀 Starting Qoder qmodel_latest model test...

📤 Request info:
   Endpoint: http://localhost:20128/v1/chat/completions
   Model: qd/qmodel_latest
   Messages: [
     { role: "user", content: "Hello, please introduce yourself in one sentence." }
   ]

📥 Response status: 200 OK

💬 Model response:

[Actual model response content...]

✅ Test completed!
📊 Response length: XX characters
```

---

## Method 2: Using curl Command

### PowerShell Version:

```powershell
# Set variables
$API_KEY = "your-api-key-here"
$MODEL = "qd/qmodel_latest"

# Send request
curl.exe -X POST http://localhost:20128/v1/chat/completions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $API_KEY" `
  -d '{
    \"model\": \"qd/qmodel_latest\",
    \"messages\": [
      {\"role\": \"user\", \"content\": \"Hello, please introduce yourself in one sentence.\"}
    ],
    \"stream\": false,
    \"max_tokens\": 500
  }'
```

### Git Bash / WSL Version:

```bash
# Set variables
API_KEY="your-api-key-here"
MODEL="qd/qmodel_latest"

# Send request
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "qd/qmodel_latest",
    "messages": [
      {"role": "user", "content": "Hello, please introduce yourself in one sentence."}
    ],
    "stream": false,
    "max_tokens": 500
  }'
```

---

## Method 3: Using PowerShell Script

Create `test-qoder-model.ps1`:

```powershell
# Configuration
$API_KEY = "your-api-key-here"
$BASE_URL = "http://localhost:20128"

# Request body
$body = @{
    model = "qd/qmodel_latest"
    messages = @(
        @{
            role = "user"
            content = "Hello, please introduce yourself in one sentence."
        }
    )
    stream = $false
    max_tokens = 500
} | ConvertTo-Json -Depth 10

Write-Host "🚀 Starting Qoder qmodel_latest model test...`n"
Write-Host "📤 Request info:"
Write-Host "   Endpoint: $BASE_URL/v1/chat/completions"
Write-Host "   Model: qd/qmodel_latest`n"

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/v1/chat/completions" `
        -Method Post `
        -Headers @{
            "Content-Type" = "application/json"
            "Authorization" = "Bearer $API_KEY"
        } `
        -Body $body

    Write-Host "✅ Response successful!`n"
    Write-Host "💬 Model response:`n"
    Write-Host $response.choices[0].message.content
    Write-Host "`n📊 Token usage:"
    Write-Host "   Input: $($response.usage.prompt_tokens)"
    Write-Host "   Output: $($response.usage.completion_tokens)"
    Write-Host "   Total: $($response.usage.total_tokens)"
}
catch {
    Write-Host "❌ Request failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host "`nTips:" -ForegroundColor Yellow
    Write-Host "  1. Make sure 9Router service is running"
    Write-Host "  2. Check if API_KEY is correct"
    Write-Host "  3. Make sure Qoder connection is configured"
}
```

Run:
```powershell
.\test-qoder-model.ps1
```

---

## Troubleshooting

### Error 1: Connection Failed
```
Error: fetch failed
```
**Solution**: Check if 9Router is running
```bash
# Start 9Router
npm run dev
# or
npm run start
```

### Error 2: 401 Unauthorized
```
{"error":{"message":"Invalid API key"}}
```
**Solution**: Check if API Key is correct
- Visit Dashboard to get a new API Key
- Make sure API Key has "Bearer " prefix

### Error 3: Model Not Supported
```
{"error":{"message":"Unsupported qoder model: \"qmodel_latest\""}}
```
**Solution**:
1. Make sure the code fix is applied (static validation removed)
2. Restart 9Router service
3. Click "Fetch Qoder Models" button in Dashboard

### Error 4: No Qoder Connection Configured
```
{"error":{"message":"No active Qoder connection"}}
```
**Solution**:
1. Visit `http://localhost:20128/dashboard/providers/qoder`
2. Add Qoder OAuth connection
3. Make sure connection status is "Active"

---

## Test Other Models

Modify the `model` parameter in the script to test other Qoder models:

```javascript
// Basic models
"qd/auto"           // Auto select
"qd/ultimate"       // Ultimate
"qd/performance"    // Performance
"qd/efficient"      // Efficient
"qd/lite"           // Lite

// Frontier models
"qd/qmodel"         // Qwen model
"qd/qmodel_latest"  // Qwen latest
"qd/dmodel"         // DeepSeek model
"qd/dfmodel"        // DeepSeek Flash
"qd/gm51model"      // GLM 5.1
"qd/kmodel"         // Kimi model
"qd/mmodel"         // MiniMax model
```

---

## Advanced Testing

### Test Streaming Response

The Node.js script already supports streaming by default (`stream: true`)

### Test Non-Streaming Response

Modify in the script:
```javascript
stream: false  // Change to false
```

### Test Function Calling

```javascript
const requestBody = {
  model: "qd/qmodel_latest",
  messages: testMessages,
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather information for a specified city",
        parameters: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "City name"
            }
          },
          required: ["city"]
        }
      }
    }
  ],
  tool_choice: "auto"
};
```
