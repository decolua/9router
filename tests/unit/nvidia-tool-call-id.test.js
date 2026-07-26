import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("NVIDIA tool call IDs", () => {
  it("uses the same 9-character alphanumeric ID for calls and results", () => {
    const out = new DefaultExecutor("nvidia").transformRequest("mistralai/mistral-medium-3.5-128b", {
      messages: [
        { role: "assistant", tool_calls: [{ id: "6075034-0", type: "function", function: { name: "test", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "6075034-0", content: "ok" },
      ],
    });

    expect(out.messages[0].tool_calls[0].id).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(out.messages[1].tool_call_id).toBe(out.messages[0].tool_calls[0].id);
  });
});
