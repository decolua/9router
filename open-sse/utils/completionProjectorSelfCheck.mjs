import assert from "node:assert/strict";
import { createSseDoneTracker } from "./sseDoneTracker.js";
import { projectCompletionToClientFormat, responsesApiToOpenAICompletion } from "../translator/response/completionProjector.js";

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const completion = {
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 1,
  model: "m",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: "answer",
      reasoning_content: "thought",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "lookup", arguments: "{\"q\":\"x\"}" }
      }]
    },
    finish_reason: "tool_calls"
  }],
  usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }
};

check("Gemini-family projection preserves text, thought, and functionCall", () => {
  const projected = projectCompletionToClientFormat(completion, "antigravity");
  const parts = projected.response.candidates[0].content.parts;
  assert.deepEqual(parts[0], { text: "thought", thought: true });
  assert.deepEqual(parts[1], { text: "answer" });
  assert.deepEqual(parts[2], { functionCall: { id: "call-1", name: "lookup", args: { q: "x" } } });
  assert.equal(projected.response.usageMetadata.totalTokenCount, 8);
});

check("Claude projection preserves text, thinking, and tool_use", () => {
  const projected = projectCompletionToClientFormat(completion, "claude");
  assert.equal(projected.type, "message");
  assert.deepEqual(projected.content.map(part => part.type), ["thinking", "text", "tool_use"]);
  assert.deepEqual(projected.content[2], { type: "tool_use", id: "call-1", name: "lookup", input: { q: "x" } });
});

check("Ollama projection preserves tool_calls", () => {
  const projected = projectCompletionToClientFormat(completion, "ollama");
  assert.equal(projected.message.content, "answer");
  assert.equal(projected.message.thinking, "thought");
  assert.deepEqual(projected.message.tool_calls[0].function, { name: "lookup", arguments: { q: "x" } });
});

check("Responses output normalizes to OpenAI completion with tool_calls", () => {
  const normalized = responsesApiToOpenAICompletion({
    id: "resp-1",
    status: "completed",
    output: [
      { type: "message", content: [{ type: "output_text", text: "hello" }] },
      { type: "function_call", call_id: "call-resp", name: "lookup", arguments: "{\"q\":\"x\"}" }
    ],
    usage: { input_tokens: 1, output_tokens: 2 }
  }, "m");
  assert.equal(normalized.choices[0].message.content, "hello");
  assert.equal(normalized.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(normalized.choices[0].message.tool_calls[0].function, { name: "lookup", arguments: "{\"q\":\"x\"}" });
});

check("Projected Gemini output matches expected semantic structure", () => {
  const projected = projectCompletionToClientFormat(completion, "antigravity");
  const expected = {
    response: {
      candidates: [{
        content: {
          role: "model",
          parts: [
            { text: "thought", thought: true },
            { text: "answer" },
            { functionCall: { id: "call-1", name: "lookup", args: { q: "x" } } }
          ]
        },
        finishReason: "STOP",
        index: 0
      }],
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 5,
        totalTokenCount: 8
      },
      modelVersion: "m",
      responseId: "chatcmpl-test"
    }
  };
  assert.deepEqual(projected, expected);
});

check("OPENAI_RESPONSES projection produces response object with function_call", () => {
  const projected = projectCompletionToClientFormat(completion, "openai-responses");
  assert.equal(projected.object, "response");
  assert.equal(projected.status, "completed");
  const types = projected.output.map(item => item.type);
  assert.deepEqual(types, ["reasoning", "message", "function_call"]);
  assert.equal(projected.output[1].content[0].text, "answer");
  const fc = projected.output[2];
  assert.equal(fc.call_id, "call-1");
  assert.equal(fc.name, "lookup");
  assert.equal(fc.arguments, "{\"q\":\"x\"}");
  assert.equal(projected.usage.total_tokens, 8);
});

check("OPENAI_RESPONSES text-only completion projects message output", () => {
  const textOnly = {
    id: "chatcmpl-t",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
  const projected = projectCompletionToClientFormat(textOnly, "openai-responses");
  assert.equal(projected.output[0].type, "message");
  assert.equal(projected.output[0].content[0].text, "hi");
  assert.equal(projected.status, "completed");
});

// Edge case: null/undefined completion → returned as-is (fail-open)
check("null completion returns null", () => {
  assert.equal(projectCompletionToClientFormat(null, "claude"), null);
  assert.equal(projectCompletionToClientFormat(undefined, "gemini"), undefined);
});

// Edge case: completion with no choices → returned as-is by all projectors
check("Completion with no choices returned as-is", () => {
  const noChoices = { id: "x", model: "m", choices: [] };
  assert.equal(projectCompletionToClientFormat(noChoices, "claude"), noChoices);
  assert.equal(projectCompletionToClientFormat(noChoices, "gemini"), noChoices);
  assert.equal(projectCompletionToClientFormat(noChoices, "ollama"), noChoices);
  assert.equal(projectCompletionToClientFormat(noChoices, "openai-responses"), noChoices);
});

// Edge case: OpenAI passthrough → default switch returns completion unchanged
check("OpenAI format passthrough returns completion unchanged", () => {
  assert.equal(projectCompletionToClientFormat(completion, "openai"), completion);
  assert.equal(projectCompletionToClientFormat(completion, "unknown-format"), completion);
});

// Edge case: Ollama text-only (no tool_calls, no reasoning)
check("Ollama text-only projection", () => {
  const textOnly = {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
  const projected = projectCompletionToClientFormat(textOnly, "ollama");
  assert.equal(projected.message.content, "hello");
  assert.equal(projected.message.tool_calls, undefined);
  assert.equal(projected.message.thinking, undefined);
  assert.equal(projected.done, true);
  assert.equal(projected.done_reason, "stop");
  assert.equal(projected.prompt_eval_count, 1);
  assert.equal(projected.eval_count, 1);
});

// Edge case: Gemini text-only (no tool_calls, no reasoning)
check("Gemini text-only projection", () => {
  const textOnly = {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
  const projected = projectCompletionToClientFormat(textOnly, "gemini");
  const parts = projected.response.candidates[0].content.parts;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, "hello");
  assert.equal(parts[0].thought, undefined);
  assert.equal(projected.response.candidates[0].finishReason, "STOP");
  assert.equal(projected.response.usageMetadata.totalTokenCount, 2);
});

check("Gemini finish reason maps length and content_filter", () => {
  const length = {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "partial" }, finish_reason: "length" }]
  };
  const filtered = {
    ...length,
    choices: [{ index: 0, message: { role: "assistant", content: "blocked" }, finish_reason: "content_filter" }]
  };
  assert.equal(projectCompletionToClientFormat(length, "gemini").response.candidates[0].finishReason, "MAX_TOKENS");
  assert.equal(projectCompletionToClientFormat(filtered, "gemini").response.candidates[0].finishReason, "SAFETY");
});

check("Responses reasoning output normalizes to OpenAI reasoning_content", () => {
  const normalized = responsesApiToOpenAICompletion({
    id: "resp-r",
    status: "completed",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "why" }] },
      { type: "message", content: [{ type: "output_text", text: "answer" }] }
    ]
  }, "m");
  assert.equal(normalized.choices[0].message.reasoning_content, "why");
  assert.equal(normalized.choices[0].message.content, "answer");
});

check("Responses projection preserves text before function_call", () => {
  const projected = projectCompletionToClientFormat(completion, "openai-responses");
  assert.deepEqual(projected.output.map(item => item.type), ["reasoning", "message", "function_call"]);
  assert.equal(projected.output[1].content[0].text, "answer");
});

check("Responses usage folds cache and reasoning tokens into OpenAI pivot", () => {
  const normalized = responsesApiToOpenAICompletion({
    id: "resp-u",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }],
    usage: {
      input_tokens: 12,
      output_tokens: 4,
      cache_read_input_tokens: 5332,
      output_tokens_details: { reasoning_tokens: 7 }
    }
  }, "m");
  assert.equal(normalized.usage.prompt_tokens, 5344);
  assert.equal(normalized.usage.completion_tokens, 4);
  assert.equal(normalized.usage.total_tokens, 5348);
  assert.equal(normalized.usage.prompt_tokens_details.cached_tokens, 5332);
  assert.equal(normalized.usage.completion_tokens_details.reasoning_tokens, 7);
});

check("Gemini functionCall carries a deterministic id", () => {
  const nameless = {
    id: "chatcmpl-g",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ type: "function", function: { name: "lookup", arguments: "{}" } }]
      },
      finish_reason: "tool_calls"
    }]
  };
  const part = projectCompletionToClientFormat(nameless, "gemini").response.candidates[0].content.parts.find(p => p.functionCall);
  assert.equal(part.functionCall.id, "call_lookup");
  assert.equal(part.functionCall.name, "lookup");
});

check("Passthrough forwards exactly one OpenAI DONE sentinel", () => {
  const tracker = createSseDoneTracker();
  assert.equal(tracker.shouldForward('data: {"choices":[]}'), true);
  assert.equal(tracker.hasSeenDone(), false);
  assert.equal(tracker.shouldForward("data: [DONE]"), true);
  assert.equal(tracker.hasSeenDone(), true);
  assert.equal(tracker.shouldForward("data: [DONE]"), false);
});

// Edge case: Claude text-only (no tool_calls, no thinking)
check("Claude text-only projection", () => {
  const textOnly = {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
  const projected = projectCompletionToClientFormat(textOnly, "claude");
  assert.equal(projected.type, "message");
  assert.equal(projected.content.length, 1);
  assert.equal(projected.content[0].type, "text");
  assert.equal(projected.content[0].text, "hello");
  assert.equal(projected.stop_reason, "end_turn");
  assert.equal(projected.usage.input_tokens, 1);
  assert.equal(projected.usage.output_tokens, 1);
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    fn();
    console.log(`ok   - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}`);
    console.error(err);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) process.exit(1);
