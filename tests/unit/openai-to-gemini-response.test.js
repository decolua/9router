/**
 * Unit tests for open-sse/translator/response/openai-to-gemini.js
 *
 * Upstream only registered an "openai -> antigravity" response translator.
 * Gemini, Gemini CLI, and Vertex clients streaming from an OpenAI-native
 * provider had no "openai -> X" response translator registered, so
 * translateResponse() fell through unchanged and the client (which expects
 * a Gemini response.candidates[] envelope) received a raw OpenAI
 * chat.completion.chunk instead.
 */

import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const openaiChunks = [
  { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { reasoning_content: "think" }, finish_reason: null }] },
  { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] },
  { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] }, finish_reason: null }] },
  { id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } },
];

describe.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX])(
  "openai -> %s streaming response projection",
  (clientFormat) => {
    it("projects OpenAI chunks into the Gemini response.candidates envelope", () => {
      const state = initState(clientFormat);
      const out = openaiChunks.flatMap(chunk => translateResponse(FORMATS.OPENAI, clientFormat, chunk, state) || []);

      expect(out[0].response.candidates[0].content.parts[0]).toEqual({ thought: true, text: "think" });
      expect(out[1].response.candidates[0].content.parts[0].text).toBe("answer");

      const finish = out[out.length - 1].response;
      expect(finish.candidates[0].content.parts[0].functionCall.name).toBe("lookup");
      expect(finish.candidates[0].content.parts[0].functionCall.args).toEqual({ q: "x" });
      expect(finish.usageMetadata.totalTokenCount).toBe(8);
    });

    it("never returns a raw OpenAI chat.completion.chunk shape to the client (the original bug)", () => {
      const state = initState(clientFormat);
      const out = openaiChunks.flatMap(chunk => translateResponse(FORMATS.OPENAI, clientFormat, chunk, state) || []);

      for (const item of out) {
        expect(item.object).not.toBe("chat.completion.chunk");
        expect(item.choices).toBeUndefined();
      }
    });
  }
);
