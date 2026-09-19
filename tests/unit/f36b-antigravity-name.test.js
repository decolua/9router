// F36b — espelho do F36 (REV-B nit4, irmão response/openai-to-gemini.js:91-93) aplicado em
// response/openai-to-antigravity.js:49. Provedores OpenAI-compat comuns reenviam
// function.name em todo delta de tool_call; com `accum.name +=` o nome dobrava
// ("Read"+"Read" → "ReadRead"). Harness copiado de tests/unit/f16-openai-to-gemini-stream.test.js.
import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Chunks do cliente antigravity vêm envelopados: { response: { candidates: [...] } }.
function runStream(events) {
  const state = initState(FORMATS.ANTIGRAVITY);
  const all = [];
  for (const ev of events) {
    const out = translateResponse(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, ev, state);
    if (Array.isArray(out)) all.push(...out);
    else if (out) all.push(out);
  }
  return all;
}

const openaiChunk = (delta, finish_reason = null) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 0,
  model: "gemini-3-flash",
  choices: [{ index: 0, delta, ...(finish_reason ? { finish_reason } : {}) }],
});

describe("F36b openai→antigravity response route — tool name accumulation", () => {
  it("name repetido em deltas sucessivos não duplica (paridade F36: 'Read'+'Read' → 'Read')", () => {
    const out = runStream([
      openaiChunk({
        tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: '{"path":' } }],
      }),
      openaiChunk({
        tool_calls: [{ index: 0, function: { name: "Read", arguments: '"a.ts"}' } }],
      }),
      openaiChunk({}, "tool_calls"),
    ]);
    const parts = out.flatMap((c) => c.response?.candidates?.[0]?.content?.parts || []);
    const fc = parts.find((p) => p.functionCall);
    expect(fc).toBeDefined();
    expect(fc.functionCall.name).toBe("Read"); // RED hoje: "ReadRead" (accum.name += )
    expect(fc.functionCall.args).toEqual({ path: "a.ts" });
  });
});
