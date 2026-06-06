import { describe, it, expect } from "vitest";
import { ensureToolCallIds, fixMissingToolResponses } from "../../open-sse/translator/helpers/toolCallHelper.js";

describe("fixMissingToolResponses", () => {
  it("backfills only missing tool responses when partial results exist", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          tool_calls: [
            { id: "call_a", type: "function", function: { name: "a", arguments: "{}" } },
            { id: "call_b", type: "function", function: { name: "b", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_a", content: "done" },
        { role: "user", content: "continue" },
      ],
    };

    fixMissingToolResponses(body);

    const toolMessages = body.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((m) => m.tool_call_id).sort()).toEqual(["call_a", "call_b"]);
    expect(toolMessages.find((m) => m.tool_call_id === "call_b")?.content).toBe("");
  });
});
