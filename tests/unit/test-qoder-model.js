/**
 * Test script for Qoder qmodel_latest model interaction
 * 
 * Usage:
 *   node tests/unit/test-qoder-model.js
 * 
 * Requirements:
 *   - 9Router service is running (http://localhost:20128)
 *   - Qoder connection is configured and API Key is obtained
 */

const BASE_URL = "http://localhost:20128";
const API_KEY = "your-api-key-here"; // Get your API Key from Dashboard

// Test messages
const testMessages = [
  { role: "user", content: "Hello, please introduce yourself in one sentence." }
];

async function testQoderModel() {
  console.log("🚀 Starting Qoder qmodel_latest model test...\n");
  
  const requestBody = {
    model: "qd/qmodel_latest",
    messages: testMessages,
    stream: true,
    max_tokens: 500
  };

  console.log("📤 Request info:");
  console.log(`   Endpoint: ${BASE_URL}/v1/chat/completions`);
  console.log(`   Model: ${requestBody.model}`);
  console.log(`   Messages: ${JSON.stringify(testMessages, null, 2)}\n`);

  try {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`📥 Response status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Request failed:");
      console.error(errorText);
      return;
    }

    // Handle streaming response
    console.log("💬 Model response:\n");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.trim() || line.trim() === "data: [DONE]") continue;
        if (!line.startsWith("data: ")) continue;

        try {
          const jsonStr = line.slice(6); // Remove "data: " prefix
          const data = JSON.parse(jsonStr);
          const content = data.choices?.[0]?.delta?.content || "";
          
          if (content) {
            process.stdout.write(content);
            fullResponse += content;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    console.log("\n\n✅ Test completed!");
    console.log(`📊 Response length: ${fullResponse.length} characters\n`);

  } catch (error) {
    console.error("❌ Error occurred:");
    console.error(error.message);
    console.error("\nTips:");
    console.error("  1. Make sure 9Router service is running");
    console.error("  2. Check if API_KEY is correct");
    console.error("  3. Make sure Qoder connection is configured");
  }
}

// Run test
testQoderModel();
