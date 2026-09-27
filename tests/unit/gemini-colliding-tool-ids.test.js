/**
 * Regression test for #4273
 *
 * When the same tool_call_id string is reused across different turns in a long
 * conversation, the global id→name map used to overwrite the earlier entry.
 * This caused functionResponse.name to mismatch functionCall.name, triggering
 * Gemini 400 INVALID_ARGUMENT ("Request contains an invalid argument").
 *
 * Fix: resolve the functionResponse name from a per-turn scoped map built
 * from the assistant message that owns each tool call.
 */

import { describe, it, expect } from "vitest";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

const MODEL = "gemini-2.5-flash";

/**
 * Build a minimal OpenAI message history with a colliding tool_call_id:
 *   turn 1: assistant calls "edit"   with id call_AAA
 *   turn 1: tool result for call_AAA
 *   turn 2: assistant calls "bash"   with id call_AAA  ← same id reused
 *   turn 2: tool result for call_AAA
 */
function buildCollidingHistory() {
  return [
    { role: "user", content: "Do some work." },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_AAA",
          type: "function",
          function: { name: "edit", arguments: JSON.stringify({ file: "foo.js" }) }
        }
      ]
    },
    { role: "tool", tool_call_id: "call_AAA", content: "edit done" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_AAA",          // same id recycled in a later turn
          type: "function",
          function: { name: "bash", arguments: JSON.stringify({ cmd: "ls" }) }
        }
      ]
    },
    { role: "tool", tool_call_id: "call_AAA", content: "bash done" },
    { role: "assistant", content: "All done." }
  ];
}

describe("openaiToGeminiRequest — colliding tool_call_id (#4273)", () => {
  it("pairs each functionResponse.name with the functionCall.name from the same turn", () => {
    const result = openaiToGeminiRequest(MODEL, { messages: buildCollidingHistory() }, false);
    const contents = result.contents;

    // Collect all functionCall and functionResponse parts in order
    const calls = [];
    const responses = [];
    for (const turn of contents) {
      for (const part of turn.parts ?? []) {
        if (part.functionCall)    calls.push(part.functionCall);
        if (part.functionResponse) responses.push(part.functionResponse);
      }
    }

    expect(calls.length).toBe(2);
    expect(responses.length).toBe(2);

    // Turn 1: functionCall "edit" must be paired with functionResponse "edit"
    expect(calls[0].name).toBe("edit");
    expect(responses[0].name).toBe("edit");

    // Turn 2: functionCall "bash" must be paired with functionResponse "bash"
    // (before the fix this was "bash" for the call but "bash" overwriting "edit"
    //  in the global map — actually the second overwrite wins so turn-1 response
    //  would get the wrong name)
    expect(calls[1].name).toBe("bash");
    expect(responses[1].name).toBe("bash");
  });

  it("does not corrupt the earlier turn name when ids collide", () => {
    const result = openaiToGeminiRequest(MODEL, { messages: buildCollidingHistory() }, false);
    const contents = result.contents;

    // The turn-1 model content must contain functionCall { name: "edit" }
    // The turn-1 user content (response) must contain functionResponse { name: "edit" }
    // Before the fix the global map would have had call_AAA→"bash" (last write wins)
    // so the turn-1 functionResponse would have been named "bash".
    let editCallIdx = -1;
    for (let i = 0; i < contents.length; i++) {
      if (contents[i].parts?.some(p => p.functionCall?.name === "edit")) {
        editCallIdx = i;
        break;
      }
    }
    expect(editCallIdx).toBeGreaterThanOrEqual(0);

    // The very next turn must be the user turn with the matching functionResponse
    const responsesTurn = contents[editCallIdx + 1];
    expect(responsesTurn?.role).toBe("user");
    const frNames = responsesTurn.parts
      .filter(p => p.functionResponse)
      .map(p => p.functionResponse.name);
    expect(frNames).toContain("edit");
    expect(frNames).not.toContain("bash");
  });
});