// F16 — response route openai→gemini (fix achado A1: docs/orchestration/findings/T1.2.md).
// Cenário A1: cliente manda body {contents:[...]} → detectFormat "gemini" (open-sse/services/provider.js:47-50);
// provider claude/openai. translateResponse(...) pivoteia target→openai→source; sem a rota
// `openai:gemini` no responseRegistry, o 2º hop (open-sse/translator/index.js:198-211) deixa o
// chunk OpenAI cru passar ({"id":"chatcmpl…","choices":[…]}) onde o cliente espera candidates/parts.
//
// Harness runStream copiado de tests/translator/golden-response-stream.test.js (mesmo contrato:
// translateResponse(targetFormat=PROVEDOR, sourceFormat=CLIENTE)). Asserções explícitas (sem
// snapshot) para não acoplar a campos voláteis (created/responseId).
import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Chunks de resposta Gemini (REST/streaming) são o objeto generateContent cru:
// {candidates:[{content:{role:"model",parts:[...]}}],usageMetadata?,...} — SEM envelope
// `response` (esse é o invólucro antigravity; o decoder irmão aceita ambos: chunk.response || chunk).
function geminiText(chunks) {
  return chunks
    .flatMap((c) => c.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter((t) => typeof t === "string" && t.length > 0)
    .join("");
}

function lastCandidate(chunks) {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const cand = chunks[i]?.candidates?.[0];
    if (cand?.finishReason) return cand;
  }
  return null;
}

// Roda a sequência de eventos por translateResponse, acumulando tudo que foi emitido.
function runStream(targetFormat, sourceFormat, events) {
  const state = initState(sourceFormat);
  const all = [];
  for (const ev of events) {
    const out = translateResponse(targetFormat, sourceFormat, ev, state);
    if (Array.isArray(out)) all.push(...out);
    else if (out) all.push(out);
  }
  return all;
}

const openaiChunk = (delta, finish_reason = null, extra = {}) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 0,
  model: "gpt-4o",
  choices: [{ index: 0, delta, ...(finish_reason ? { finish_reason } : {}) }],
  ...extra,
});

describe("F16 openai→gemini response route (provider openai, cliente gemini)", () => {
  it("converte delta.content em candidates[0].content.parts[].text (não em chunks OpenAI crus)", () => {
    const events = [
      openaiChunk({ role: "assistant", content: "" }), // role-only → sem emit (irmão antigravity pula)
      openaiChunk({ content: "Hi" }),
      openaiChunk({ content: " there" }),
      openaiChunk({}, "stop", {
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    ];
    const out = runStream(FORMATS.OPENAI, FORMATS.GEMINI, events);

    expect(out.length).toBe(3); // content, content, finish
    expect(geminiText(out)).toBe("Hi there");
    for (const chunk of out) {
      expect(chunk.candidates).toBeInstanceOf(Array);
      expect(chunk.choices).toBeUndefined(); // chunk OpenAI cru vazando = bug A1
    }
    expect(out[0].candidates[0].content.role).toBe("model");
  });

  it("finish_reason stop→STOP, length→MAX_TOKENS, content_filter→SAFETY", () => {
    const cases = [
      ["stop", "STOP"],
      ["length", "MAX_TOKENS"],
      ["content_filter", "SAFETY"],
    ];
    for (const [openaiReason, geminiReason] of cases) {
      const out = runStream(FORMATS.OPENAI, FORMATS.GEMINI, [
        openaiChunk({ content: "x" }),
        openaiChunk({}, openaiReason),
      ]);
      expect(lastCandidate(out)?.finishReason).toBe(geminiReason);
    }
  });

  it("acumula usage que chega em chunk separado (choices:[]) e anexa ao emit", () => {
    const out = runStream(FORMATS.OPENAI, FORMATS.GEMINI, [
      openaiChunk({ content: "Hi" }),
      openaiChunk({}, "stop"), // sem usage no finish (provedores OpenAI-compat comuns)
      { id: "chatcmpl-1", object: "chat.completion.chunk", created: 0, model: "gpt-4o", choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
    ]);
    const usageBearers = out.filter((c) => c.usageMetadata);
    expect(usageBearers.length).toBeGreaterThan(0);
    expect(usageBearers[usageBearers.length - 1].usageMetadata).toMatchObject({
      promptTokenCount: 3,
      candidatesTokenCount: 4,
      totalTokenCount: 7,
    });
  });

  it("tool_calls acumulados viram part functionCall no finish (paridade com irmão antigravity)", () => {
    const out = runStream(FORMATS.OPENAI, FORMATS.GEMINI, [
      openaiChunk({
        tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":' } }],
      }),
      openaiChunk({
        tool_calls: [{ index: 0, function: { arguments: '"x"}' } }],
      }),
      openaiChunk({}, "tool_calls"),
    ]);
    const parts = out.flatMap((c) => c.candidates?.[0]?.content?.parts || []);
    const fc = parts.find((p) => p.functionCall);
    expect(fc).toBeDefined();
    expect(fc.functionCall.name).toBe("search");
    expect(fc.functionCall.args).toEqual({ q: "x" });
    // Gemini não tem finishReason próprio para tool call → irmão mapeia STOP.
    expect(lastCandidate(out)?.finishReason).toBe("STOP");
  });

  it("não vaza o sentinel literal [DONE] nem texto de controle no output", () => {
    const events = [
      openaiChunk({ role: "assistant", content: "" }),
      openaiChunk({ content: "Hi" }),
      openaiChunk({}, "stop"),
    ];
    const out = runStream(FORMATS.OPENAI, FORMATS.GEMINI, events);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("[DONE]");
    expect(geminiText(out)).toBe("Hi");
  });

  it("flush (chunk null) não explode nem emite lixo", () => {
    const state = initState(FORMATS.GEMINI);
    translateResponse(FORMATS.OPENAI, FORMATS.GEMINI, openaiChunk({ content: "Hi" }), state);
    const flushed = translateResponse(FORMATS.OPENAI, FORMATS.GEMINI, null, state);
    expect(flushed.every((c) => c && (c.candidates || !c.choices))).toBe(true);
  });
});

describe("F16 cenário A1 ponta-a-ponta: provider claude → cliente gemini (2 hops claude→openai→gemini)", () => {
  const claudeEvents = [
    { type: "message_start", message: { id: "msg_a1", model: "claude-opus-4-6", usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 3, output_tokens: 1 } },
    { type: "message_stop" },
  ];

  it("saída final é candidates/parts com text 'Hi' — NÃO JSON cru da OpenAI (RED hoje: A1)", () => {
    const out = runStream(FORMATS.CLAUDE, FORMATS.GEMINI, claudeEvents);

    // RED hoje: sem a rota openai:gemini no 2º hop, os chunks convertidos para OpenAI
    // passam crus ({id:"chatcmpl-…",choices:[…]}) — exatamente a evidência de T1.2.md:41-42.
    expect(geminiText(out)).toBe("Hi");
    expect(lastCandidate(out)?.finishReason).toBe("STOP");
    for (const chunk of out) {
      expect(chunk.choices).toBeUndefined();
      expect(chunk.candidates).toBeInstanceOf(Array);
    }
  });
});
