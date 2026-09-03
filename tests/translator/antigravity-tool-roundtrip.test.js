import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { splitToolCallId } from "../../open-sse/translator/concerns/thoughtSignature.js";

const signature = "real-gemini-signature";

describe("Antigravity tool round-trip", () => {
  it("preserves the Gemini thought signature across non-streaming Claude turns", () => {
    const response = {
      responseId: "resp-1",
      modelVersion: "gemini-3.1-pro-preview",
      candidates: [{
        content: {
          role: "model",
          parts: [{
            thoughtSignature: signature,
            functionCall: { id: "gemini-call-1", name: "read_file", args: { path: "a.js" } },
          }],
        },
        finishReason: "STOP",
      }],
    };

    const openAI = translateNonStreamingResponse(response, FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);
    const toolCall = openAI.choices[0].message.tool_calls[0];
    expect(splitToolCallId(toolCall.id).thoughtSignature).toBe(signature);

    const next = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.ANTIGRAVITY,
      "gemini-3.1-pro-preview",
      {
        messages: [
          { role: "user", content: "continue" },
          { role: "assistant", content: [{ type: "tool_use", id: toolCall.id, name: toolCall.function.name, input: JSON.parse(toolCall.function.arguments) }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: toolCall.id, content: "ok" }] },
        ],
        tools: [{
          name: "read_file",
          description: "Read a file",
          input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        }],
      },
      false,
      { projectId: "project-1", connectionId: "roundtrip" },
      "antigravity",
    );

    const replayed = next.request.contents
      .find(content => content.role === "model")
      ?.parts.find(part => part.functionCall);
    expect(replayed?.thoughtSignature).toBe(signature);
    expect(replayed?.functionCall?.id).toBe("gemini-call-1");
  });
});
