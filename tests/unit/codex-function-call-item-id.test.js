import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transformInput(input) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.6-sol",
    input,
    stream: true,
  };

  executor.transformRequest("gpt-5.6-sol", body, true, {
    connectionId: "test-codex-stateless-item-id",
    providerSpecificData: {},
  });

  return body.input;
}

const TARGET_ITEMS = {
  function_call: {
    legalId: "fc_valid_1",
    payload: { call_id: "call_function", name: "shell", arguments: "{\"cmd\":\"pwd\"}", status: "completed" },
  },
  function_call_output: {
    legalId: "fco_valid_1",
    payload: { call_id: "call_function", output: "done", status: "completed" },
  },
  custom_tool_call: {
    legalId: "ctc_valid_1",
    payload: { call_id: "call_custom", name: "codex_app", input: "PAYLOAD", status: "completed" },
  },
  custom_tool_call_output: {
    legalId: "ctco_valid_1",
    payload: { call_id: "call_custom", output: "RESULT", status: "completed" },
  },
};

describe("CodexExecutor stateless item IDs", () => {
  it.each(Object.entries(TARGET_ITEMS))("removes every optional %s id and preserves its payload", (type, fixture) => {
    const ids = ["item_replayed_1", fixture.legalId, 42, null];
    const source = [
      ...ids.map((id, sequence) => ({ type, id, ...fixture.payload, sequence })),
      { type, ...fixture.payload, sequence: ids.length },
    ];

    const input = transformInput(source);

    expect(input).toHaveLength(source.length);
    input.forEach((item, sequence) => {
      expect(item).toEqual({ type, ...fixture.payload, sequence });
    });
  });

  it("preserves IDs and payloads on non-call items", () => {
    const source = [
      { type: "message", id: "msg_history_1", role: "assistant", content: [{ type: "output_text", text: "continue" }] },
      { type: "message", id: "item_message_1", role: "user", content: [{ type: "input_text", text: "again" }] },
      { type: "reasoning", id: "rs_history_1", encrypted_content: "ENCRYPTED_REASONING" },
      { type: "reasoning", id: "item_reasoning_1", summary: [{ type: "summary_text", text: "summary" }] },
      { type: "future_response_item", id: "item_future_1", payload: "PAYLOAD" },
      { id: "item_implicit_message_1", role: "user", content: "hello" },
    ];

    expect(transformInput(source)).toEqual(source);
  });

  it("removes stored item references while preserving ordinary input", () => {
    const storedReferences = [
      "at_stored", "msg_stored", "amsg_stored", "rs_stored", "lsh_stored",
      "fc_stored", "tsc_stored", "fco_stored", "ctc_stored", "ctco_stored",
      "tso_stored", "ws_stored", "ig_stored", "cmp_stored", "resp_stored",
    ];

    const input = transformInput([
      ...storedReferences,
      { type: "item_reference", id: "item_stored" },
      "ordinary text",
      { type: "message", id: "msg_kept", role: "user", content: "continue" },
    ]);

    expect(input).toEqual([
      "ordinary text",
      { type: "message", id: "msg_kept", role: "user", content: "continue" },
    ]);
  });

  it("preserves function and custom call/output pairing through call_id", () => {
    const input = transformInput([
      { type: "function_call", id: "item_fc", call_id: "call_function", name: "shell", arguments: "{}" },
      { type: "function_call_output", id: "item_fco", call_id: "call_function", output: "done" },
      { type: "custom_tool_call", id: "item_ctc", call_id: "call_custom", name: "codex_app", input: "PAYLOAD" },
      { type: "custom_tool_call_output", id: "item_ctco", call_id: "call_custom", output: "RESULT" },
    ]);

    expect(input).toEqual([
      { type: "function_call", call_id: "call_function", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call_function", output: "done" },
      { type: "custom_tool_call", call_id: "call_custom", name: "codex_app", input: "PAYLOAD" },
      { type: "custom_tool_call_output", call_id: "call_custom", output: "RESULT" },
    ]);
  });

  it.each([
    [58, "function_call", "function_call_output", { name: "shell", arguments: "{}" }],
    [434, "custom_tool_call", "custom_tool_call_output", { name: "codex_app", input: "PAYLOAD" }],
  ])("normalizes a call/output pair after %i replayed history items", (targetIndex, callType, outputType, callPayload) => {
    const callId = `call_reported_${targetIndex}`;
    const history = Array.from({ length: targetIndex }, (_, index) => ({
      type: "message",
      id: `msg_history_${index}`,
      role: "user",
      content: [{ type: "input_text", text: `step ${index}` }],
    }));
    history.push(
      { type: callType, id: `item_call_${targetIndex}`, call_id: callId, ...callPayload },
      { type: outputType, id: `item_output_${targetIndex}`, call_id: callId, output: "RESULT" },
    );

    const input = transformInput(history);

    expect(input[targetIndex - 1].id).toBe(`msg_history_${targetIndex - 1}`);
    expect(input[targetIndex]).toEqual({ type: callType, call_id: callId, ...callPayload });
    expect(input[targetIndex + 1]).toEqual({ type: outputType, call_id: callId, output: "RESULT" });
  });
});
