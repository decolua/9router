# Issue 705 Responses Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both 9router Responses-format emitters always include a dense, deterministic `response.output` array on terminal `response.completed`, so Hermes-Agent and other strict clients can parse streamed Responses payloads without crashing.

**Architecture:** Keep the fix local to the two response-producing implementations. Persist the exact finalized items already emitted in `response.output_item.done`, sort them by numeric `output_index`, preserve stable finalization order for same-index items, collapse sparse keys into a dense array, and attach that array to terminal `response.completed`. Back the change with a focused contract test file that exercises transformer and translator parity.

**Tech Stack:** Node.js, Web Streams API, Vitest, Next.js build pipeline, OpenAI Responses SSE translation helpers.

---

## File Structure

- `open-sse/transformer/responsesTransformer.js`
  - Live `/v1/responses` SSE transformer used by `responsesHandler.js`.
  - Needs state for completed output items, collision logging, dense output construction, and updated terminal `response.completed` payload.

- `open-sse/translator/response/openai-responses.js`
  - Parallel OpenAI-chat → Responses translator that mirrors the same contract.
  - Needs the same completed-item accumulation policy and terminal `response.completed.response.output` behaviour.

- `tests/unit/responses-output-contract.test.js`
  - New focused contract test file.
  - Covers transformer and translator message output, empty output, multi-item ordering, same-index preservation, sparse-index collapse, and function-call preservation.

- `.gitignore`
  - Already updated to allow `docs/superpowers/plans/*.md`; no further changes expected during implementation unless test artifacts unexpectedly appear.

## Task 1: Add the failing contract tests

**Files:**
- Create: `tests/unit/responses-output-contract.test.js`
- Modify: none
- Test: `tests/unit/responses-output-contract.test.js`

- [ ] **Step 1: Write the failing test file**

```js
import { describe, it, expect, afterEach, vi } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function chatChunk({ id = "chatcmpl-test", index = 0, delta = {}, finish_reason = null }) {
  return {
    id,
    choices: [{ index, delta, finish_reason }],
  };
}

function sseData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function parseSseEvents(raw) {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event:\s*(.+)$/m)?.[1] ?? null;
      const dataLine = block.match(/^data:\s*(.+)$/m)?.[1] ?? "";
      if (dataLine === "[DONE]") {
        return { event: "done", data: "[DONE]" };
      }
      return { event, data: JSON.parse(dataLine) };
    });
}

async function collectTransformerEvents(chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  const reader = source.pipeThrough(createResponsesApiTransformStream()).getReader();
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }

  raw += decoder.decode();
  return parseSseEvents(raw);
}

function createTranslatorState() {
  return {
    seq: 0,
    responseId: "resp_seed",
    created: 1700000000,
    started: false,
    msgTextBuf: {},
    msgItemAdded: {},
    msgContentAdded: {},
    msgItemDone: {},
    reasoningId: "",
    reasoningIndex: -1,
    reasoningBuf: "",
    reasoningPartAdded: false,
    reasoningDone: false,
    inThinking: false,
    funcArgsBuf: {},
    funcNames: {},
    funcCallIds: {},
    funcArgsDone: {},
    funcItemDone: {},
    completedSent: false,
  };
}

function collectTranslatorEvents(chunks) {
  const state = createTranslatorState();
  const events = [];

  for (const chunk of chunks) {
    events.push(...openaiToOpenAIResponsesResponse(chunk, state));
  }

  return events;
}

function completedResponse(events) {
  const completedEvent = events.find(({ event }) => event === "response.completed");
  expect(completedEvent, "response.completed event must exist").toBeDefined();
  return completedEvent.data.response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Responses output contract", () => {
  it("transformer includes final message output on response.completed", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-msg", index: 0, delta: { content: "Hello from 9router" } })),
      sseData(chatChunk({ id: "chatcmpl-msg", index: 0, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([
      {
        id: "msg_resp_chatcmpl-msg_0",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            annotations: [],
            logprobs: [],
            text: "Hello from 9router",
          },
        ],
      },
    ]);
  });

  it("transformer emits output: [] when no items finalize", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-empty", index: 0, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([]);
  });

  it("transformer preserves reasoning before assistant output and collapses sparse indexes", async () => {
    const events = await collectTransformerEvents([
      sseData(chatChunk({ id: "chatcmpl-order", index: 0, delta: { reasoning_content: "Check constraints." } })),
      sseData(chatChunk({ id: "chatcmpl-order", index: 2, delta: { content: "Proceed." } })),
      sseData(chatChunk({ id: "chatcmpl-order", index: 2, delta: {}, finish_reason: "stop" })),
      "data: [DONE]\n\n",
    ]);

    const response = completedResponse(events);
    expect(response.output).toHaveLength(2);
    expect(response.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(response.output[0].summary[0].text).toBe("Check constraints.");
    expect(response.output[1].content[0].text).toBe("Proceed.");
  });

  it("transformer preserves function_call items in final output", async () => {
    const events = await collectTransformerEvents([
      sseData(
        chatChunk({
          id: "chatcmpl-tool",
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 3,
                id: "call_lookup_1",
                function: {
                  name: "lookupWeather",
                  arguments: '{"city":"London"}',
                },
              },
            ],
          },
        })
      ),
      sseData(chatChunk({ id: "chatcmpl-tool", index: 0, delta: {}, finish_reason: "tool_calls" })),
      "data: [DONE]\n\n",
    ]);

    const response = completedResponse(events);
    expect(response.output).toHaveLength(1);
    expect(response.output[0]).toEqual({
      id: "fc_call_lookup_1",
      type: "function_call",
      call_id: "call_lookup_1",
      name: "lookupWeather",
      arguments: '{"city":"London"}',
    });
  });

  it("translator includes final message output on response.completed", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-msg", index: 0, delta: { content: "Translator online" } }),
      chatChunk({ id: "chatcmpl-translator-msg", index: 0, delta: {}, finish_reason: "stop" }),
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([
      {
        id: "msg_resp_chatcmpl-translator-msg_0",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            annotations: [],
            logprobs: [],
            text: "Translator online",
          },
        ],
      },
    ]);
  });

  it("translator emits output: [] when no items finalize", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-empty", index: 0, delta: {}, finish_reason: "stop" }),
    ]);

    const response = completedResponse(events);
    expect(response.output).toEqual([]);
  });

  it("translator preserves reasoning/message order and collapses sparse indexes", () => {
    const events = collectTranslatorEvents([
      chatChunk({ id: "chatcmpl-translator-order", index: 0, delta: { reasoning_content: "Plan first." } }),
      chatChunk({ id: "chatcmpl-translator-order", index: 2, delta: { content: "Then ship." } }),
      chatChunk({ id: "chatcmpl-translator-order", index: 2, delta: {}, finish_reason: "stop" }),
    ]);

    const response = completedResponse(events);
    expect(response.output).toHaveLength(2);
    expect(response.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(response.output[0].summary[0].text).toBe("Plan first.");
    expect(response.output[1].content[0].text).toBe("Then ship.");
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run:

```bash
cd tests
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js unit/responses-output-contract.test.js
```

Expected:
- FAIL on the transformer and translator completion-contract assertions
- representative failure shape: `expected undefined to deeply equal [...]` or `expected undefined to deeply equal []` for `response.output`

- [ ] **Step 3: Confirm the failure matches issue #705 before changing code**

Check that the failure is specifically the missing terminal field, not a broken test harness:

- transformer failures should show `response.completed` exists but `response.completed.response.output` is missing
- translator failures should show the same omission on the returned `response.completed` event

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/unit/responses-output-contract.test.js
git commit -m "test: add issue 705 responses output contract coverage"
```

### Task 2: Fix the live transformer used by `/v1/responses`

**Files:**
- Modify: `open-sse/transformer/responsesTransformer.js:55-77`
- Modify: `open-sse/transformer/responsesTransformer.js:128-240`
- Test: `tests/unit/responses-output-contract.test.js`

- [ ] **Step 1: Run only the transformer tests to confirm the live-path failure before editing**

Run:

```bash
cd tests
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js unit/responses-output-contract.test.js -t "transformer"
```

Expected:
- FAIL on all transformer contract tests because `response.completed.response.output` is missing

- [ ] **Step 2: Add completed-item accumulation, dense ordering, and terminal output emission to `responsesTransformer.js`**

Update the transformer state and helpers near the top of `createResponsesApiTransformStream()`:

```js
  const state = {
    seq: 0,
    responseId: `resp_${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    started: false,
    msgTextBuf: {},
    msgItemAdded: {},
    msgContentAdded: {},
    msgItemDone: {},
    reasoningId: "",
    reasoningIndex: -1,
    reasoningBuf: "",
    reasoningPartAdded: false,
    reasoningDone: false,
    inThinking: false,
    funcArgsBuf: {},
    funcNames: {},
    funcCallIds: {},
    funcArgsDone: {},
    funcItemDone: {},
    completedOutputItems: [],
    buffer: "",
    completedSent: false
  };

  const normalizeOutputIndex = (outputIndex) => {
    const normalized = Number(outputIndex);
    return Number.isInteger(normalized) && normalized >= 0 ? normalized : 0;
  };

  const recordCompletedItem = (outputIndex, item) => {
    const normalized = normalizeOutputIndex(outputIndex);
    state.completedOutputItems.push({
      output_index: normalized,
      item,
      seq: state.seq
    });
    return normalized;
  };

  const buildDenseOutput = () =>
    state.completedOutputItems
      .slice()
      .sort((left, right) => {
        if (left.output_index !== right.output_index) {
          return left.output_index - right.output_index;
        }
        return left.seq - right.seq;
      })
      .map(({ item }) => item);
```

Update each completion helper so it persists the exact same item object it emits in `response.output_item.done`:

```js
  const closeReasoning = (controller) => {
    if (state.reasoningId && !state.reasoningDone) {
      state.reasoningDone = true;

      emit(controller, "response.reasoning_summary_text.done", {
        type: "response.reasoning_summary_text.done",
        item_id: state.reasoningId,
        output_index: state.reasoningIndex,
        summary_index: 0,
        text: state.reasoningBuf
      });

      emit(controller, "response.reasoning_summary_part.done", {
        type: "response.reasoning_summary_part.done",
        item_id: state.reasoningId,
        output_index: state.reasoningIndex,
        summary_index: 0,
        part: { type: "summary_text", text: state.reasoningBuf }
      });

      const item = {
        id: state.reasoningId,
        type: "reasoning",
        summary: [{ type: "summary_text", text: state.reasoningBuf }]
      };

      emit(controller, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: state.reasoningIndex,
        item
      });

      recordCompletedItem(state.reasoningIndex, item);
    }
  };
```

```js
  const closeMessage = (controller, idx) => {
    if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
      state.msgItemDone[idx] = true;
      const normalizedIndex = normalizeOutputIndex(idx);
      const fullText = state.msgTextBuf[idx] || "";
      const msgId = `msg_${state.responseId}_${normalizedIndex}`;

      emit(controller, "response.output_text.done", {
        type: "response.output_text.done",
        item_id: msgId,
        output_index: normalizedIndex,
        content_index: 0,
        text: fullText,
        logprobs: []
      });

      emit(controller, "response.content_part.done", {
        type: "response.content_part.done",
        item_id: msgId,
        output_index: normalizedIndex,
        content_index: 0,
        part: { type: "output_text", annotations: [], logprobs: [], text: fullText }
      });

      const item = {
        id: msgId,
        type: "message",
        content: [{ type: "output_text", annotations: [], logprobs: [], text: fullText }],
        role: "assistant"
      };

      emit(controller, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: normalizedIndex,
        item
      });

      recordCompletedItem(normalizedIndex, item);
    }
  };
```

```js
  const closeToolCall = (controller, idx) => {
    const callId = state.funcCallIds[idx];
    if (callId && !state.funcItemDone[idx]) {
      const normalizedIndex = normalizeOutputIndex(idx);
      const args = state.funcArgsBuf[idx] || "{}";

      emit(controller, "response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: `fc_${callId}`,
        output_index: normalizedIndex,
        arguments: args
      });

      const item = {
        id: `fc_${callId}`,
        type: "function_call",
        arguments: args,
        call_id: callId,
        name: state.funcNames[idx] || ""
      };

      emit(controller, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: normalizedIndex,
        item
      });

      recordCompletedItem(normalizedIndex, item);
      state.funcItemDone[idx] = true;
      state.funcArgsDone[idx] = true;
    }
  };
```

Update `sendCompleted()` to emit the dense terminal `output` array:

```js
  const sendCompleted = (controller) => {
    if (!state.completedSent) {
      state.completedSent = true;
      emit(controller, "response.completed", {
        type: "response.completed",
        response: {
          id: state.responseId,
          object: "response",
          created_at: state.created,
          status: "completed",
          background: false,
          error: null,
          output: buildDenseOutput()
        }
      });
    }
  };
```

- [ ] **Step 3: Run only the transformer tests and verify they pass**

Run:

```bash
cd tests
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js unit/responses-output-contract.test.js -t "transformer"
```

Expected:
- PASS on all transformer tests
- translator tests may still be failing if the full file is run, which is correct at this stage

- [ ] **Step 4: Commit the live transformer fix**

```bash
git add open-sse/transformer/responsesTransformer.js
git commit -m "fix: include completed output in responses transformer"
```

### Task 3: Bring the parallel translator path into parity

**Files:**
- Modify: `open-sse/translator/response/openai-responses.js:12-112`
- Modify: `open-sse/translator/response/openai-responses.js:116-355`
- Test: `tests/unit/responses-output-contract.test.js`

- [ ] **Step 1: Run only the translator tests to confirm the remaining parity failure**

Run:

```bash
cd tests
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js unit/responses-output-contract.test.js -t "translator"
```

Expected:
- FAIL because the translator still emits `response.completed` without `response.output`

- [ ] **Step 2: Add the same dense-output policy to `openai-responses.js`**

Add helper functions near the top of the file, below `openaiToOpenAIResponsesResponse()` or above the existing helper section:

```js
function ensureCompletedOutputState(state) {
  if (Array.isArray(state.completedOutputItems)) {
    return state.completedOutputItems;
  }

  if (state.completedOutputItems instanceof Map) {
    state.completedOutputItems = Array.from(state.completedOutputItems.entries()).map(
      ([output_index, item], seq) => ({ output_index, item, seq })
    );
    return state.completedOutputItems;
  }

  state.completedOutputItems = [];
  return state.completedOutputItems;
}

function normalizeOutputIndex(outputIndex) {
  const normalized = Number(outputIndex);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function recordCompletedItem(state, outputIndex, item) {
  const completedOutputItems = ensureCompletedOutputState(state);
  const normalized = normalizeOutputIndex(outputIndex);
  completedOutputItems.push({
    output_index: normalized,
    item,
    seq: state.seq
  });
  return normalized;
}

function buildDenseOutput(state) {
  return ensureCompletedOutputState(state)
    .slice()
    .sort((left, right) => {
      if (left.output_index !== right.output_index) {
        return left.output_index - right.output_index;
      }
      return left.seq - right.seq;
    })
    .map(({ item }) => item);
}
```

Update the completion helpers to emit and persist the same finalized item objects:

```js
function closeReasoning(state, emit) {
  if (state.reasoningId && !state.reasoningDone) {
    state.reasoningDone = true;

    emit("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      text: state.reasoningBuf
    });

    emit("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      part: { type: "summary_text", text: state.reasoningBuf }
    });

    const item = {
      id: state.reasoningId,
      type: "reasoning",
      summary: [{ type: "summary_text", text: state.reasoningBuf }]
    };

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.reasoningIndex,
      item
    });

    recordCompletedItem(state, state.reasoningIndex, item);
  }
}
```

```js
function closeMessage(state, emit, idx) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
    state.msgItemDone[idx] = true;
    const normalizedIndex = normalizeOutputIndex(idx);
    const fullText = state.msgTextBuf[idx] || "";
    const msgId = `msg_${state.responseId}_${normalizedIndex}`;

    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: msgId,
      output_index: normalizedIndex,
      content_index: 0,
      text: fullText,
      logprobs: []
    });

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: normalizedIndex,
      content_index: 0,
      part: { type: "output_text", annotations: [], logprobs: [], text: fullText }
    });

    const item = {
      id: msgId,
      type: "message",
      content: [{ type: "output_text", annotations: [], logprobs: [], text: fullText }],
      role: "assistant"
    };

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: normalizedIndex,
      item
    });

    recordCompletedItem(state, normalizedIndex, item);
  }
}
```

```js
function closeToolCall(state, emit, idx) {
  const callId = state.funcCallIds[idx];
  if (callId && !state.funcItemDone[idx]) {
    const normalizedIndex = normalizeOutputIndex(idx);
    const args = state.funcArgsBuf[idx] || "{}";

    emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: `fc_${callId}`,
      output_index: normalizedIndex,
      arguments: args
    });

    const item = {
      id: `fc_${callId}`,
      type: "function_call",
      arguments: args,
      call_id: callId,
      name: state.funcNames[idx] || ""
    };

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: normalizedIndex,
      item
    });

    recordCompletedItem(state, normalizedIndex, item);
    state.funcItemDone[idx] = true;
    state.funcArgsDone[idx] = true;
  }
}
```

Update `sendCompleted()` to include the dense output array:

```js
function sendCompleted(state, emit) {
  if (!state.completedSent) {
    state.completedSent = true;
    emit("response.completed", {
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "completed",
        background: false,
        error: null,
        output: buildDenseOutput(state)
      }
    });
  }
}
```

- [ ] **Step 3: Run the full contract file and verify all tests pass**

Run:

```bash
cd tests
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js unit/responses-output-contract.test.js
```

Expected:
- PASS on all contract tests in `unit/responses-output-contract.test.js`
- no remaining assertion about missing terminal `response.output`

- [ ] **Step 4: Commit the translator parity fix**

```bash
git add open-sse/translator/response/openai-responses.js
git commit -m "fix: include completed output in openai responses translator"
```

### Task 4: Run focused verification and build validation

**Files:**
- Modify: none
- Test: `tests/unit/responses-output-contract.test.js`
- Verify: `open-sse/transformer/responsesTransformer.js`
- Verify: `open-sse/translator/response/openai-responses.js`

- [ ] **Step 1: Re-run the focused contract file from the dedicated test harness**

Run:

```bash
cd tests
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js unit/responses-output-contract.test.js
```

Expected:
- PASS on the focused contract file
- stable confirmation that message, empty, multi-item, sparse-index, and function-call scenarios all preserve terminal `response.output`

- [ ] **Step 2: Run the production build from the repository root**

Run:

```bash
cd ..
npm run build
```

Expected:
- Next.js production build completes successfully
- no syntax or import regressions from the two touched response-producing files

- [ ] **Step 3: Perform a local transformer smoke check and inspect the final SSE event**

Run:

```bash
node --input-type=module <<'EOF'
import { createResponsesApiTransformStream } from "./open-sse/transformer/responsesTransformer.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const source = new ReadableStream({
  start(controller) {
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          id: "chatcmpl-smoke",
          choices: [{ index: 0, delta: { content: "Jarvis online" }, finish_reason: null }],
        })}\n\n`
      )
    );
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          id: "chatcmpl-smoke",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`
      )
    );
    controller.close();
  },
});

const reader = source.pipeThrough(createResponsesApiTransformStream()).getReader();
let raw = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  raw += decoder.decode(value, { stream: true });
}
raw += decoder.decode();
console.log(raw);
EOF
```

Expected:
- printed stream contains a terminal `event: response.completed`
- its `response` object now includes `"output":[{"id":"msg_resp_chatcmpl-smoke_0"...}]`
- `[DONE]` still appears after the completed event

## Self-Review

- Spec coverage: this plan maps directly to the approved design’s two implementation targets and its verification requirements.
- Placeholder scan: no red-flag placeholders remain; every step includes exact files, commands, and code snippets.
- Type consistency: both implementations use the same append-only finalized-item record policy / dense-ordering policy and the same terminal field name `response.output`.
