// Issue #2930 — Codex Responses rejects replayed tool-call history when function /
// custom tool call items carry a client-supplied `id`. stripStoredItemReferences must
// drop the optional `id` (keeping call_id) for function_call / function_call_output /
// custom_tool_call / custom_tool_call_output.

import { describe, expect, it } from "vitest";
import { stripStoredItemReferences } from "../../open-sse/executors/codex.js";

describe("stripStoredItemReferences tool-call id stripping (#2930)", () => {
  it("drops id from function_call / function_call_output but keeps call_id", () => {
    const body = {
      input: [
        { type: "function_call", id: "fc_abc123", call_id: "call_xyz", name: "search", arguments: "{}" },
        { type: "function_call_output", id: "fco_def456", call_id: "call_xyz", output: "result" },
      ],
    };
    stripStoredItemReferences(body);
    expect(body.input[0].id).toBeUndefined();
    expect(body.input[0].call_id).toBe("call_xyz");
    expect(body.input[1].id).toBeUndefined();
    expect(body.input[1].call_id).toBe("call_xyz");
  });

  it("drops id from custom_tool_call / custom_tool_call_output", () => {
    const body = {
      input: [
        { type: "custom_tool_call", id: "ctc_1", call_id: "c_1", name: "py", input: {} },
        { type: "custom_tool_call_output", id: "ctco_1", call_id: "c_1", output: "ok" },
      ],
    };
    stripStoredItemReferences(body);
    expect(body.input[0].id).toBeUndefined();
    expect(body.input[0].call_id).toBe("c_1");
    expect(body.input[1].id).toBeUndefined();
    expect(body.input[1].call_id).toBe("c_1");
  });

  it("does NOT strip id from non-tool items with non-server id", () => {
    const body = { input: [{ type: "message", id: "local_user_1", role: "user", content: "hi" }] };
    stripStoredItemReferences(body);
    expect(body.input[0].id).toBe("local_user_1");
  });

  it("handles long replay histories with mixed items", () => {
    const body = {
      input: [
        { type: "message", id: "local_a", role: "user", content: "a" },
        { type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" },
        { type: "function_call_output", id: "fco_1", call_id: "c1", output: "x" },
        { type: "message", id: "local_b", role: "assistant", content: "b" },
      ],
    };
    stripStoredItemReferences(body);
    expect(body.input[0].id).toBe("local_a");
    expect(body.input[1].id).toBeUndefined();
    expect(body.input[1].call_id).toBe("c1");
    expect(body.input[2].id).toBeUndefined();
    expect(body.input[3].id).toBe("local_b");
  });

  it("still strips server-generated item_reference and SERVER_ID_PATTERN ids", () => {
    const body = {
      input: [
        { type: "item_reference", id: "resp_abc" },
        { type: "message", id: "resp_xyz", role: "user", content: "hi" },
        "resp_dangling",
      ],
    };
    stripStoredItemReferences(body);
    // item_reference removed entirely
    expect(body.input.find((i) => i?.type === "item_reference")).toBeUndefined();
    // SERVER_ID_PATTERN id stripped from message
    expect(body.input.find((i) => i?.type === "message")?.id).toBeUndefined();
    // dangling server-id string removed
    expect(body.input).not.toContain("resp_dangling");
  });
});
