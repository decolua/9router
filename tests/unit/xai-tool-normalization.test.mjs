import assert from "node:assert/strict";
import { test } from "node:test";
import { DefaultExecutor, normalizeXaiResponsesPayload, normalizeXaiResponsesTools } from "../../open-sse/executors/default.js";

test("xAI Responses tool normalization converts unsupported Codex tools", () => {
  const body = normalizeXaiResponsesTools({
    tools: [
      { type: "function", name: "shell_command", parameters: { type: "object" } },
      { type: "custom", name: "apply_patch", description: "patch", format: { type: "grammar" } },
      { type: "local_shell" },
      { type: "web_search", external_web_access: true },
      { type: "computer", display_width: 1024 },
    ],
  });

  assert.deepEqual(body.tools, [
    { type: "function", name: "shell_command", description: "", parameters: { type: "object", properties: {} } },
    {
      type: "function",
      name: "apply_patch",
      description: "patch",
      parameters: {
        type: "object",
        properties: { input: { type: "string", description: "Freeform tool input." } },
        required: ["input"],
      },
    },
    { type: "web_search" },
  ]);
});

test("xAI Responses payload normalization strips encrypted reasoning blobs", () => {
  const body = normalizeXaiResponsesPayload({
    include: ["reasoning.encrypted_content"],
    input: [
      { type: "reasoning", encrypted_content: "blob" },
      {
        type: "reasoning",
        encrypted_content: "blob",
        summary: [{ type: "summary_text", text: "kept" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi", encrypted_content: "nested" }],
      },
    ],
  });

  assert.deepEqual(body, {
    input: [
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "kept" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
    ],
  });
});
