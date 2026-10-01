import { tryParseJSON, sanitizeFunctionResponseResult } from "../open-sse/translator/formats/gemini.js";
import { openaiToAntigravityRequest } from "../open-sse/translator/request/openai-to-gemini.js";

console.log("Running Gemini/Antigravity function response sanitization test...");

// Test 1: tryParseJSON sanitizes $ref, $defs, #, /
const rawSchemaPayload = JSON.stringify({
  "$ref": "#/$defs/Config",
  "$defs": {
    "Config": { "type": "object", "properties": { "name": { "type": "string" } } }
  },
  "deep/nested": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "field#tag": 123
  }
});

const sanitized = tryParseJSON(rawSchemaPayload);
if (
  sanitized._ref !== "#/$defs/Config" ||
  !sanitized._defs?.Config ||
  sanitized["deep_nested"]._schema !== "http://json-schema.org/draft-07/schema#" ||
  sanitized["deep_nested"].field_tag !== 123
) {
  console.error("Test 1 Failed:", sanitized);
  process.exit(1);
}
console.log("✓ Test 1 Passed: tryParseJSON sanitizes forbidden protobuf keys");

// Test 2: openaiToAntigravityRequest handles tool responses containing schema references
const mockRequest = {
  model: "gemini-3.7-flash-high",
  messages: [
    { role: "user", content: "Fetch config" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_webfetch_1",
          type: "function",
          function: {
            name: "webfetch",
            arguments: '{"url":"https://opencode.ai/config.json"}'
          }
        }
      ]
    },
    {
      role: "tool",
      tool_call_id: "call_webfetch_1",
      name: "webfetch",
      content: rawSchemaPayload
    }
  ]
};

const antigravityRequest = openaiToAntigravityRequest("gemini-3.7-flash-high", mockRequest, false);
const userTurn = antigravityRequest.request.contents.find(c => c.role === "user" && c.parts?.some(p => p.functionResponse));
if (!userTurn) {
  console.error("Test 2 Failed: user turn with functionResponse not found");
  process.exit(1);
}

const funcResp = userTurn.parts.find(p => p.functionResponse)?.functionResponse;
if (!funcResp) {
  console.error("Test 2 Failed: functionResponse part missing");
  process.exit(1);
}

const res = funcResp.response?.result;
if (res._ref !== "#/$defs/Config" || !res._defs?.Config) {
  console.error("Test 2 Failed: response.result not properly sanitized:", res);
  process.exit(1);
}
console.log("✓ Test 2 Passed: openaiToAntigravityRequest produces clean functionResponse without protobuf conflict");

console.log("All tests passed successfully!");
