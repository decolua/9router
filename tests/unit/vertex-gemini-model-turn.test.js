import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("OpenAI → Gemini / Vertex requests ending with model turn", () => {
  it("appends user turn when message history ends with assistant message", () => {
    const body = {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi! How can I help you today?" }
      ]
    };

    const geminiReq = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-3.6-flash", body, true, null, "gemini");
    const vertexReq = translateRequest(FORMATS.OPENAI, FORMATS.VERTEX, "vertex/gemini-3.6-flash", body, true, null, "vertex");

    const lastGeminiTurn = geminiReq.contents.at(-1);
    const lastVertexTurn = vertexReq.contents.at(-1);

    expect(lastGeminiTurn.role).toBe("user");
    expect(lastGeminiTurn.parts[0].text).toBe("Continue");

    expect(lastVertexTurn.role).toBe("user");
    expect(lastVertexTurn.parts[0].text).toBe("Continue");
  });

  it("appends user turn with functionResponse when assistant message ends with unresponded tool_calls", () => {
    const body = {
      messages: [
        { role: "user", content: "Check weather in Jakarta" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Jakarta"}' }
            }
          ]
        }
      ]
    };

    const vertexReq = translateRequest(FORMATS.OPENAI, FORMATS.VERTEX, "vertex/gemini-3.6-flash", body, true, null, "vertex");
    const lastTurn = vertexReq.contents.at(-1);

    expect(lastTurn.role).toBe("user");
    expect(lastTurn.parts[0].functionResponse).toBeDefined();
    expect(lastTurn.parts[0].functionResponse.name).toBe("get_weather");
    expect(lastTurn.parts[0].functionResponse.response.result).toBe("No response provided");
    // Vertex post-processing strips `id`
    expect(lastTurn.parts[0].functionResponse.id).toBeUndefined();
  });
});
