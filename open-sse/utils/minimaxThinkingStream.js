// MiniMax M3 streaming can leak thinking markers into delta.content even with
// reasoning_split. Peel markers into reasoning_content for OpenAI clients.

import { PROVIDERS } from "../config/providers.js";

const START_MARKERS = ["<think>", "<mm:think>"];
const END_MARKERS = ["</think>", "</mm:think>"];

const MINIMAX_THINKING_PROVIDERS = new Set(["minimax", "minimax-cn"]);

export function isMinimaxThinkingProvider(provider) {
  return MINIMAX_THINKING_PROVIDERS.has(provider);
}

export function shouldOmitStreamReasoning(provider) {
  const transports = PROVIDERS[provider]?.transports;
  if (!Array.isArray(transports)) return false;
  return transports.some((t) => t.format === "openai" && t.omitStreamReasoning === true);
}

export function stripClientReasoningDelta(delta) {
  if (!delta || typeof delta !== "object") return false;
  let changed = false;
  for (const key of ["reasoning_content", "reasoning", "reasoning_details"]) {
    if (delta[key] !== undefined) {
      delete delta[key];
      changed = true;
    }
  }
  return changed;
}

export function createMinimaxThinkingStreamState() {
  return { carry: "", inThinking: false };
}

function extractReasoningDetails(details) {
  if (!Array.isArray(details)) return "";
  return details
    .map((d) => (typeof d === "string" ? d : d?.text || d?.content || ""))
    .join("");
}

function findEarliestMarker(text, markers) {
  let best = { idx: -1, marker: "" };
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && (best.idx === -1 || idx < best.idx)) {
      best = { idx, marker };
    }
  }
  return best;
}

function incompleteMarkerSuffixLen(text, markers) {
  let hold = 0;
  for (const marker of markers) {
    const max = Math.min(text.length, marker.length - 1);
    for (let len = max; len >= 1; len--) {
      if (marker.startsWith(text.slice(text.length - len))) {
        hold = Math.max(hold, len);
        break;
      }
    }
  }
  return hold;
}

export function processMinimaxThinkingText(text, inThinking) {
  let input = text;
  let content = "";
  let reasoning = "";
  let thinking = inThinking;

  while (input.length > 0) {
    if (thinking) {
      const { idx, marker } = findEarliestMarker(input, END_MARKERS);
      if (idx === -1) {
        const hold = incompleteMarkerSuffixLen(input, END_MARKERS);
        reasoning += input.slice(0, input.length - hold);
        return { content, reasoning, carry: input.slice(input.length - hold), inThinking: true };
      }
      reasoning += input.slice(0, idx);
      input = input.slice(idx + marker.length);
      thinking = false;
      continue;
    }

    const start = findEarliestMarker(input, START_MARKERS);
    const end = findEarliestMarker(input, END_MARKERS);
    const useEnd = end.idx !== -1 && (start.idx === -1 || end.idx < start.idx);

    if (useEnd) {
      content += input.slice(0, end.idx);
      input = input.slice(end.idx + end.marker.length);
      continue;
    }

    if (start.idx === -1) {
      const hold = incompleteMarkerSuffixLen(input, [...START_MARKERS, ...END_MARKERS]);
      content += input.slice(0, input.length - hold);
      return { content, reasoning, carry: input.slice(input.length - hold), inThinking: false };
    }
    content += input.slice(0, start.idx);
    input = input.slice(start.idx + start.marker.length);
    thinking = true;
  }

  return { content, reasoning, carry: "", inThinking: thinking };
}

export function flushMinimaxThinkingStreamState(state) {
  if (!state?.carry) return { content: "", reasoning: "" };
  const tail = state.carry;
  state.carry = "";
  if (state.inThinking) return { content: "", reasoning: tail };
  return { content: tail, reasoning: "" };
}

// Mutates delta in place. Returns true when the delta was changed.
export function sanitizeMinimaxDelta(delta, state) {
  if (!delta || typeof delta !== "object" || !state) return false;
  let changed = false;

  if (typeof delta.reasoning === "string" && delta.reasoning) {
    delta.reasoning_content = `${delta.reasoning_content || ""}${delta.reasoning}`;
    delete delta.reasoning;
    changed = true;
  }

  const fromDetails = extractReasoningDetails(delta.reasoning_details);
  if (fromDetails) {
    const existing = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
    if (!existing.includes(fromDetails)) {
      delta.reasoning_content = `${existing}${fromDetails}`;
    }
    changed = true;
  }

  if (typeof delta.content !== "string" || !delta.content) return changed;

  const merged = `${state.carry}${delta.content}`;
  state.carry = "";
  const split = processMinimaxThinkingText(merged, state.inThinking);
  state.carry = split.carry;
  state.inThinking = split.inThinking;

  if (split.content) {
    if (split.content !== delta.content) {
      delta.content = split.content;
      changed = true;
    }
  } else {
    delete delta.content;
    changed = true;
  }

  if (split.reasoning) {
    delta.reasoning_content = `${delta.reasoning_content || ""}${split.reasoning}`;
    changed = true;
  }

  return changed;
}
