// Normalize DeepSeek DSML inline tool calls in OpenAI-shaped response chunks.
//
// Some DeepSeek-family upstreams emit tool calls as visible text rather than
// structured tool_call frames. Left alone the markers reach the client as prose
// and the agent never runs the tool. This concern rewrites the text stream into
// native `tool_calls` deltas, and is a strict no-op when no DSML is present.

import { createDsmlStreamState, containsDsmlToolCall } from "../../utils/dsmlToolCalls.js";
import { fallbackToolCallId } from "./toolCall.js";

// Qoder names its DeepSeek models `dmodel` / `dfmodel`; every other provider
// spells the family out. Matching on the upstream id keeps this off unrelated
// models even when they share a combo with a DeepSeek member.
const DEEPSEEK_MODEL_RE = /deepseek|^d[f]?model$|\/d[f]?model$/i;

export function isDeepSeekFamilyModel(model) {
  return typeof model === "string" && DEEPSEEK_MODEL_RE.test(model);
}

/**
 * Rewrite OpenAI chat.completion chunks so DSML text becomes tool_calls.
 * `state` is the per-stream translator state; the DSML buffer lives on it so
 * chunks that split a tag mid-way still reassemble.
 */
export function normalizeDsmlChunks(chunks, state) {
  if (!state || !Array.isArray(chunks) || chunks.length === 0) return chunks;
  // No model-name gate: combo/fallback aliases (e.g. "opus55-sol61") can be
  // served by a DeepSeek member, so the alias says nothing about the dialect.
  // Non-DeepSeek ids arm only once a chunk actually carries a DSML marker.
  if (
    !state.dsmlStream &&
    !isDeepSeekFamilyModel(state.model) &&
    // `<` arms too: a tag split as "<" + "| DSML | invoke…" across chunks would
    // otherwise lose its opener. The parser only holds a short `<` tail.
    !chunks.some((c) => typeof c?.choices?.[0]?.delta?.content === "string" && /DSML|</.test(c.choices[0].delta.content))
  ) {
    return chunks;
  }

  // Arm for every DeepSeek-family stream. The parser forwards ordinary prose
  // immediately and only holds back a tail that could still become a tag, so
  // the cost on DSML-free traffic is a few characters of latency at a `<`.
  if (!state.dsmlStream) {
    state.dsmlStream = createDsmlStreamState();
    state.dsmlToolIndex = 0;
  }

  const out = [];
  for (const chunk of chunks) {
    const delta = chunk?.choices?.[0]?.delta;
    if (!delta || typeof delta.content !== "string") {
      // A terminal chunk ends the stream: release anything still buffered so a
      // held tail is never lost on paths that do not call an explicit flush.
      if (chunk?.choices?.[0]?.finish_reason) {
        out.push(...flushDsmlChunks(state, chunk));
        if (chunk.choices[0].finish_reason === "stop" && state.dsmlToolIndex > 0) {
          out.push({ ...chunk, choices: [{ ...chunk.choices[0], finish_reason: "tool_calls" }] });
          continue;
        }
      }
      out.push(chunk);
      continue;
    }

    const { text, toolCalls } = state.dsmlStream.push(delta.content);
    const emitted = [];

    if (text) {
      emitted.push({ ...chunk, choices: [{ ...chunk.choices[0], delta: { ...delta, content: text } }] });
    }

    for (const call of toolCalls) {
      const index = state.dsmlToolIndex++;
      emitted.push({
        ...chunk,
        choices: [{
          ...chunk.choices[0],
          delta: {
            ...(emitted.length === 0 && state.chunkIndex === 0 ? { role: "assistant" } : {}),
            tool_calls: [{
              index,
              id: fallbackToolCallId(index),
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            }],
          },
        }],
      });
    }

    // Content and a terminal flag can share a chunk; flush after the calls so
    // the released tail still precedes finish_reason.
    if (chunk.choices[0].finish_reason) {
      for (const t of flushDsmlChunks(state, chunk)) {
        emitted.push({ ...t, choices: [{ ...t.choices[0], finish_reason: null }] });
      }
    }

    // Suppress the original chunk when its content was entirely a tool block.
    if (emitted.length === 0 && !toolCalls.length) {
      const rest = { ...delta };
      delete rest.content;
      if (Object.keys(rest).length > 0) {
        out.push({ ...chunk, choices: [{ ...chunk.choices[0], delta: rest }] });
      }
    }

    // One chunk can fan out into several. The terminal flag must land on the
    // last of them, or the client sees finish_reason before the tail.
    let finish = chunk.choices[0].finish_reason;
    // Upstream said "stop" because it thinks it wrote prose; the client must see
    // "tool_calls" or agent loops will not execute the extracted calls.
    if (finish === "stop" && state.dsmlToolIndex > 0) finish = "tool_calls";
    if (finish && emitted.length > 0) {
      for (const e of emitted) e.choices[0].finish_reason = null;
      emitted[emitted.length - 1].choices[0].finish_reason = finish;
    }
    out.push(...emitted);
  }
  return out;
}

/** Release any buffered tail when the stream ends. */
export function flushDsmlChunks(state, template) {
  if (!state?.dsmlStream) return [];
  const { text, toolCalls } = state.dsmlStream.flush();
  state.dsmlStream = null;
  const out = [];
  if (text && template) {
    out.push({ ...template, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  }
  for (const call of toolCalls) {
    const index = state.dsmlToolIndex++;
    out.push({
      ...template,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: fallbackToolCallId(index),
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          }],
        },
        finish_reason: null,
      }],
    });
  }
  return out;
}
