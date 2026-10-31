// Live DotHoosh catalog as the router sees it: lanes, wire format and limits per model id,
// built from the two public listings (GET /v1/models and GET /anthropic/v1/models). The server
// refreshes it (src/lib/modelCatalog/dothoosh.js); until then, and for ids the listings do not
// carry, callers fall back to the name-based family table in helpers.js.
//
// Isomorphic on purpose (capabilities.js is bundled into the browser too): no node imports. The
// slot lives on globalThis because the server bundles this module into several route chunks and
// each copy would otherwise carry its own state.

import { FORMATS } from "../../translator/formats.js";

const PROTOCOL_FORMATS = {
  "openai-chat-completions": FORMATS.OPENAI,
  "openai-responses": FORMATS.OPENAI_RESPONSES,
  "anthropic-messages": FORMATS.CLAUDE,
};
// Stable lane order: Chat Completions first, then Responses, then the Anthropic lane.
const LANE_ORDER = [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE];

// "model(level)" is a 9router thinking override; the listing knows the bare id.
const keyOf = (modelId) => String(modelId).replace(/\([^()]+\)\s*$/, "").trim().toLowerCase();

const positive = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);

const protocolsOf = (row) =>
  (Array.isArray(row?.protocols) ? row.protocols : [])
    .map((item) => (typeof item === "string" ? item : item?.protocol))
    .filter((protocol) => typeof protocol === "string");

function lanesOf(openaiRow, anthropicRow) {
  const lanes = new Set();
  if (openaiRow) {
    for (const protocol of protocolsOf(openaiRow)) {
      if (PROTOCOL_FORMATS[protocol]) lanes.add(PROTOCOL_FORMATS[protocol]);
    }
    // A row that names no protocol sits on the OpenAI listing, i.e. Chat Completions.
    if (lanes.size === 0) lanes.add(FORMATS.OPENAI);
  }
  // Listed on the Anthropic route too (DeepSeek is on both).
  if (anthropicRow) lanes.add(FORMATS.CLAUDE);
  return LANE_ORDER.filter((lane) => lanes.has(lane));
}

function entryOf(openaiRow, anthropicRow) {
  const supportedFormats = lanesOf(openaiRow, anthropicRow);
  const row = openaiRow || anthropicRow;
  const modalities = row.architecture?.input_modalities;

  let targetFormat;
  // Prefer the Responses API for any model that offers it (GPT-6 takes function tools only there).
  if (supportedFormats.includes(FORMATS.OPENAI_RESPONSES)) targetFormat = FORMATS.OPENAI_RESPONSES;
  else if (supportedFormats.length === 1 && supportedFormats[0] === FORMATS.CLAUDE) targetFormat = FORMATS.CLAUDE;

  return {
    supportedFormats,
    ...(targetFormat && { targetFormat }),
    contextWindow: positive(row.top_provider?.context_length) ?? positive(row.context_length),
    maxOutput: positive(row.top_provider?.max_completion_tokens) ?? positive(row.max_output_tokens),
    ...(Array.isArray(modalities) && { vision: modalities.includes("image") }),
  };
}

/** Lane, wire-format and limit table keyed by lower-case model id. */
export function buildDotHooshLive({ openai = [], anthropic = [] } = {}) {
  const rows = (list) => new Map(list.filter((row) => typeof row?.id === "string" && row.id.trim()).map((row) => [keyOf(row.id), row]));
  const onOpenAI = rows(openai);
  const onAnthropic = rows(anthropic);
  const table = {};
  for (const key of new Set([...onOpenAI.keys(), ...onAnthropic.keys()])) {
    table[key] = entryOf(onOpenAI.get(key), onAnthropic.get(key));
  }
  return table;
}

export function setDotHooshLive(table) {
  globalThis.__9rDotHooshLive = table;
}

export function clearDotHooshLive() {
  globalThis.__9rDotHooshLive = null;
}

export function getDotHooshLive(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  return globalThis.__9rDotHooshLive?.[keyOf(modelId)] ?? null;
}
