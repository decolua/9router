// oc/mimo-v2.6-flash-free (OpenCode Zen free lane) reasoning support.
//
// The free lane's MiMo route is OpenRouter-backed: it validates reasoning_effort
// against the plain OpenAI enum (none|minimal|low|medium|high|xhigh|max — anything
// else 400 "Invalid option"), honours "none" by dropping thinking, and streams the
// thinking text as `reasoning` + `reasoning_details[]` instead of reasoning_content.
// The Xiaomi-family pattern this model used to inherit (always-on DeepSeek `thinking`
// object, max rejected) and the OpenAI passthrough (which only surfaces upstream
// fields verbatim) both missed that, so the level list, the off switch and the
// client-visible reasoning field are pinned here.
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { liftReasoningAliases } from "../../open-sse/translator/concerns/reasoning.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const MODEL = "mimo-v2.6-flash-free";
const PROVIDER = "opencode";
// Every value the lane accepts, probed live (200 vs 400 "Invalid option").
const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

function effortOnWire(level) {
  const body = { model: MODEL, messages: [], reasoning_effort: level };
  applyThinking(FORMATS.OPENAI, MODEL, body, PROVIDER);
  return body;
}

async function drain(stream) {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

function sseStream(events) {
  const encoder = new TextEncoder();
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function passthroughEvents(text) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.slice(6).trim() !== "[DONE]")
    .map((l) => JSON.parse(l.slice(6)));
}

describe("oc/mimo-v2.6-flash-free reasoning levels", () => {
  it("advertises the OpenAI effort enum and a working off switch", () => {
    expect(getCapabilitiesForModel(PROVIDER, MODEL)).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: true,
    });
    expect(getCapabilitiesForModel(PROVIDER, `oc/${MODEL}`).thinkingCanDisable).toBe(true);

    expect(getThinkingLevels(PROVIDER, MODEL)).toEqual(LEVELS);
    expect(getThinkingLevels(PROVIDER, `oc/${MODEL}`)).toEqual(LEVELS);
    // Runtime callers hand getThinkingLevels the clean id (applyThinking's
    // parseSuffix / the executor's baseModelId), so the "model(level)" form is
    // covered by the end-to-end wire test below rather than here.
    expect(getThinkingLevels("xiaomi-mimo", MODEL)).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("forwards every level verbatim and disables via reasoning_effort none", () => {
    for (const level of LEVELS) expect(effortOnWire(level).reasoning_effort).toBe(level);
    // The family's DeepSeek shape would emit a `thinking` object the lane ignores.
    expect(effortOnWire("none").thinking).toBeUndefined();
    expect(effortOnWire("high").thinking).toBeUndefined();
  });

  it("sends the requested level to the free chat endpoint end to end", () => {
    const executor = new OpenCodeExecutor();
    for (const level of LEVELS) {
      // The handler strips the provider prefix before dispatch (oc/… → bare id).
      const body = { model: MODEL, messages: [{ role: "user", content: "hi" }], max_tokens: 1024 };
      const translated = translateRequest(
        FORMATS.OPENAI,
        FORMATS.OPENAI,
        `${MODEL}(${level})`,
        body,
        true,
        {},
        PROVIDER,
      );
      const out = executor.transformRequest(MODEL, translated, true, { connectionId: "oc-mimo-levels-test" });
      expect(executor.buildUrl(MODEL)).toBe("https://opencode.ai/inference/v1/chat/completions");
      expect(out.reasoning_effort).toBe(level);
      expect(out.thinking).toBeUndefined();
    }
  });

  it("drops adaptive \"auto\" instead of shipping a value the lane 400s on", () => {
    const body = { model: MODEL, messages: [{ role: "user", content: "hi" }], thinking: { type: "adaptive" } };
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, MODEL, body, true, {}, PROVIDER);
    expect(translated.reasoning_effort).toBe("auto");

    const out = new OpenCodeExecutor().transformRequest(MODEL, translated, true, { connectionId: "oc-mimo-auto-test" });
    expect(out.reasoning_effort).toBeUndefined();

    // A named level still rides through untouched.
    const kept = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      MODEL,
      { model: MODEL, messages: [], reasoning_effort: "xhigh" },
      true,
      {},
      PROVIDER,
    );
    expect(new OpenCodeExecutor().transformRequest(MODEL, kept, true, {}).reasoning_effort).toBe("xhigh");
  });
});

describe("OpenCode free reasoning aliases reach OpenAI-shaped clients", () => {
  const aliasDelta = {
    id: "gen-1",
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: "", reasoning: "17*23 = 391", reasoning_details: [{ type: "reasoning.text", text: "17*23 = 391", index: 0 }] } }],
  };
  const answerDelta = {
    id: "gen-1",
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL,
    choices: [{ index: 0, finish_reason: null, delta: { role: "assistant", content: "391" } }],
  };

  it("lifts reasoning/reasoning_details into reasoning_content and keeps the aliases", () => {
    expect(liftReasoningAliases({ reasoning: "abc" })).toEqual({ reasoning: "abc", reasoning_content: "abc" });
    expect(liftReasoningAliases({ reasoning_details: [{ text: "ab" }, { content: "c" }] }).reasoning_content).toBe("abc");
    // Never rewrites a delta that already carries the canonical field.
    expect(liftReasoningAliases({ reasoning_content: "kept", reasoning: "other" })).toEqual({ reasoning_content: "kept", reasoning: "other" });
    expect(liftReasoningAliases({ content: "no thinking" })).toEqual({ content: "no thinking" });
  });

  it("streams reasoning_content on the OpenAI passthrough", async () => {
    let settled = null;
    const out = passthroughEvents(
      await drain(sseStream([aliasDelta, answerDelta]).pipeThrough(
        createPassthroughStreamWithLogger(PROVIDER, null, null, MODEL, null, null, (content) => { settled = content; }),
      )),
    );
    const first = out[0].choices[0].delta;
    expect(first.reasoning_content).toBe("17*23 = 391");
    expect(first.reasoning).toBe("17*23 = 391");
    expect(out.map((e) => e.choices[0].delta.content || "").join("")).toBe("391");
    // Usage/thinking accounting reads reasoning_content, so the dashboard would
    // have recorded no thinking for this lane before the lift.
    expect(settled).toEqual({ content: "391", thinking: "17*23 = 391" });
  });

  it("leaves other providers' deltas alone", async () => {
    const out = passthroughEvents(
      await drain(sseStream([aliasDelta]).pipeThrough(
        createPassthroughStreamWithLogger("groq", null, null, MODEL),
      )),
    );
    expect(out[0].choices[0].delta.reasoning_content).toBeUndefined();
    expect(out[0].choices[0].delta.reasoning).toBe("17*23 = 391");
  });

  it("surfaces alias reasoning to antigravity-format clients", () => {
    const out = openaiToAntigravityResponse(aliasDelta, {});
    expect(out.response.candidates[0].content.parts).toEqual([{ thought: true, text: "17*23 = 391" }]);
  });

  it("aggregates alias reasoning for forced-stream JSON clients", () => {
    const raw = `data: ${JSON.stringify(aliasDelta)}\n\ndata: ${JSON.stringify(answerDelta)}\n\n`;
    const parsed = parseSSEToOpenAIResponse(raw, MODEL);
    expect(parsed.choices[0].message.reasoning_content).toBe("17*23 = 391");
    expect(parsed.choices[0].message.content).toBe("391");

    // Reasoning-only output (token cap hit before the answer) survives as well —
    // handleForcedSSEToJson strips reasoning_content only when content is non-empty.
    const reasoningOnly = parseSSEToOpenAIResponse(`data: ${JSON.stringify(aliasDelta)}\n\n`, MODEL);
    expect(reasoningOnly.choices[0].message.content).toBe("");
    expect(reasoningOnly.choices[0].message.reasoning_content).toBe("17*23 = 391");
  });
});
