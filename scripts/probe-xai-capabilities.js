#!/usr/bin/env node
/**
 * Small transform-only probe for xAI structured outputs + function calling.
 * Does NOT load real credentials or hit the network.
 * Just verifies that DefaultExecutor("xai") passes json_schema and tools through.
 */

import { DefaultExecutor } from "../open-sse/executors/default.js";

const exec = new DefaultExecutor("xai");

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor_name: { type: "string", description: "Vendor name" },
    total_amount: { type: "number", description: "Total amount due" },
    currency: { type: "string", enum: ["USD", "EUR"] },
  },
  required: ["vendor_name", "total_amount"],
};

const tools = [
  {
    type: "function",
    function: {
      name: "get_temperature",
      description: "Get current temperature for a location",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          location: { type: "string", description: "City name" },
          unit: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["location"],
      },
    },
  },
];

console.log("=== Probe 1: response_format.json_schema ===");
const body1 = {
  model: "grok-4.3",
  messages: [{ role: "user", content: "Extract vendor and total from this invoice text." }],
  response_format: { type: "json_schema", json_schema: { name: "invoice", schema } },
};
const out1 = exec.transformRequest("grok-4.3", body1);
console.dir(out1, { depth: 3 });

console.log("\n=== Probe 2: tools + tool_choice ===");
const body2 = {
  model: "grok-4.3",
  messages: [{ role: "user", content: "What is the temperature in San Francisco?" }],
  tools,
  tool_choice: { type: "function", function: { name: "get_temperature" } },
};
const out2 = exec.transformRequest("grok-4.3", body2);
console.dir(out2, { depth: 3 });

console.log("\n=== Summary ===");
console.log("json_schema preserved:", out1.response_format?.type === "json_schema");
console.log("tools preserved:", Array.isArray(out2.tools) && out2.tools.length === 1);
console.log("tool_choice preserved:", out2.tool_choice?.function?.name === "get_temperature");
console.log("no strict injected (xAI applies implicitly):", out2.tools?.[0]?.function?.strict === undefined);
