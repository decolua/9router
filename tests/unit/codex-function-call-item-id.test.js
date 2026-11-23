/**
 * Regression tests for #2923.
 *
 * Responses accepts an optional `id` on call items, but with `store: false` that
 * `id` refers to a server-side item the upstream cannot resolve, so replaying a
 * history that carries one fails the whole request. Call/output pairing uses
 * `call_id`, so dropping `id` keeps the conversation intact.
 *
 * The prefix allowlist in `stripStoredItemReferences` only matched `rs_`/`fc_`/
 * `resp_`/`msg_` IDs, so opaque replay IDs (`item_...`), numeric IDs and nulls
 * all survived, and `custom_tool_call` was never considered at all.
 */

import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transformInput(input, model = "gpt-5.6-sol") {
  const executor = new CodexExecutor();
  const body = { model, input, stream: true };

  executor.transformRequest(model, body, true, {
    connectionId: "test-codex-stateless-item-id",
    providerSpecificData: {},
  });

  return body.input;
}

const CALL_ITEMS = {
  function_call: {
    call_id: "call_function",
    name: "shell",
    arguments: "{\"cmd\":\"pwd\"}",
    status: "completed",
  },
  function_call_output: {
    call_id: "call_function",
    output: "done",
    status: "completed",
  },
  custom_tool_call: {
    call_id: "call_custom",
    name: "codex_app",
    input: "PAYLOAD",
    status: "completed",
  },
  custom_tool_call_output: {
    call_id: "call_custom",
    output: "RESULT",
    status: "completed",
  },
};

describe("CodexExecutor stateless call item IDs", () => {
  it.each(Object.entries(CALL_ITEMS))(
    "drops every %s id shape and preserves the payload",
    (type, payload) => {
      // The prefix allowlist caught none of these, which is the bug.
      const ids = ["item_replayed_1", "fc_prefixed_1", 42, null, ""];
      const source = ids.map((id, sequence) => ({ type, id, ...payload, sequence }));

      const input = transformInput(source);

      expect(input).toEqual(
        ids.map((_, sequence) => ({ type, ...payload, sequence })),
      );
    },
  );

  it("keeps call_id as the only correlation key between a call and its output", () => {
    const input = transformInput([
      { type: "function_call", id: "item_fc", call_id: "call_function", name: "shell", arguments: "{}" },
      { type: "function_call_output", id: "fco_prefixed", call_id: "call_function", output: "done" },
      { type: "custom_tool_call", id: "item_ctc", call_id: "call_custom", name: "codex_app", input: "PAYLOAD" },
      { type: "custom_tool_call_output", id: "ctco_prefixed", call_id: "call_custom", output: "RESULT" },
    ]);

    expect(input).toEqual([
      { type: "function_call", call_id: "call_function", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call_function", output: "done" },
      { type: "custom_tool_call", call_id: "call_custom", name: "codex_app", input: "PAYLOAD" },
      { type: "custom_tool_call_output", call_id: "call_custom", output: "RESULT" },
    ]);
  });

  it("leaves IDs on every other item type alone", () => {
    const source = [
      { type: "message", id: "msg_history_1", role: "assistant", content: [{ type: "output_text", text: "continue" }] },
      { type: "message", id: "item_message_1", role: "user", content: [{ type: "input_text", text: "again" }] },
      { type: "reasoning", id: "rs_history_1", encrypted_content: "ENCRYPTED_REASONING" },
      { type: "reasoning", id: "item_reasoning_1", summary: [{ type: "summary_text", text: "summary" }] },
      { type: "future_response_item", id: "item_future_1", payload: "PAYLOAD" },
    ];

    expect(transformInput(source)).toEqual(source);
  });

  it("still drops stored string references and item_reference entries", () => {
    const input = transformInput([
      "rs_stored",
      "fc_stored",
      "resp_stored",
      "msg_stored",
      { type: "item_reference", id: "item_stored" },
      "ordinary text",
      { type: "message", role: "user", content: "continue" },
    ]);

    expect(input).toEqual([
      "ordinary text",
      { type: "message", role: "user", content: "continue" },
    ]);
  });

  it.each([
    [58, "function_call", "function_call_output", { name: "shell", arguments: "{}" }],
    [434, "custom_tool_call", "custom_tool_call_output", { name: "codex_app", input: "PAYLOAD" }],
  ])(
    "normalizes a call/output pair after %i replayed history items",
    (targetIndex, callType, outputType, callPayload) => {
      const callId = `call_reported_${targetIndex}`;
      const history = Array.from({ length: targetIndex }, (_, index) => ({
        type: "message",
        id: `history_item_${index}`,
        role: "user",
        content: [{ type: "input_text", text: `step ${index}` }],
      }));
      history.push(
        { type: callType, id: `item_call_${targetIndex}`, call_id: callId, ...callPayload },
        { type: outputType, id: `item_output_${targetIndex}`, call_id: callId, output: "RESULT" },
      );

      const input = transformInput(history);

      expect(input[targetIndex - 1].id).toBe(`history_item_${targetIndex - 1}`);
      expect(input[targetIndex]).toEqual({ type: callType, call_id: callId, ...callPayload });
      expect(input[targetIndex + 1]).toEqual({ type: outputType, call_id: callId, output: "RESULT" });
    },
  );

  it("keeps the Responses Lite developer prefix IDs that GPT-6 needs", () => {
    // #95600db1 preserves msg_ IDs on developer items for responsesLite models.
    // Dropping them here would silently undo that.
    const input = transformInput(
      [
        {
          type: "message",
          id: "msg_lite_prefix",
          role: "developer",
          content: [{ type: "input_text", text: "instructions" }],
        },
        { type: "function_call", id: "item_replayed", call_id: "c1", name: "shell", arguments: "{}" },
        { type: "function_call_output", id: "fco_prefixed", call_id: "c1", output: "done" },
      ],
      "gpt-6-sol",
    );

    const developerItem = input.find((item) => item.role === "developer" && item.id);
    expect(developerItem?.id).toBe("msg_lite_prefix");
    expect(input.find((item) => item.type === "function_call")?.id).toBeUndefined();
    expect(input.find((item) => item.type === "function_call_output")?.id).toBeUndefined();
  });
});
