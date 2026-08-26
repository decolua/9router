/**
 * Claude → Gemini Request Translator (DIRECT route, no OpenAI pivot)
 *
 * The pivot route runs claude → openai → gemini, and turn structure is what it
 * loses. Both hops rebuild the message list from scratch, and each one used to
 * drop a turn that came out empty — so an assistant reply the echo filter had
 * scrubbed disappeared at the first hop and its neighbours fused at the second.
 * The model then received a transcript in which it had never spoken and
 * continued the user's monologue instead of answering it.
 *
 * Both hops are fixed (see config/emptyTurn.js), but a pair this fragile should
 * not be crossing two lossy rebuilds at all — CLAUDE.md says to prefer a direct
 * route exactly here. This is that route: one mapping, one place turn structure
 * can be reasoned about.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { emptyTurnParts } from "../../config/emptyTurn.js";
import { normalizeGeminiContents, dropTrailingEmptyModelTurn } from "./openai-to-gemini.js";
import { DEFAULT_SAFETY_SETTINGS, tryParseJSON, cleanJSONSchemaForAntigravity } from "../formats/gemini.js";
import { DEFAULT_THINKING_AG_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { ROLE, GEMINI_ROLE, CLAUDE_BLOCK } from "../schema/index.js";

// Gemini requires: starts with [a-zA-Z_], then [a-zA-Z0-9_.:-], max 64.
function sanitizeName(name) {
  if (!name) return "_unknown";
  let s = String(name).replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
  return s.slice(0, 64);
}

function systemToParts(system) {
  if (!system) return null;
  if (typeof system === "string") return system ? [{ text: system }] : null;
  if (!Array.isArray(system)) return null;
  const parts = system
    .map((b) => (typeof b === "string" ? b : b?.text))
    .filter((t) => typeof t === "string" && t)
    .map((text) => ({ text }));
  return parts.length > 0 ? parts : null;
}

// One Claude content block → zero or more Gemini parts. Tool results are the
// only block whose Gemini role differs from its Claude role, and the caller
// handles that split.
function blockToParts(block) {
  if (!block || typeof block !== "object") return [];

  switch (block.type) {
    case CLAUDE_BLOCK.TEXT:
      return typeof block.text === "string" && block.text ? [{ text: block.text }] : [];

    case CLAUDE_BLOCK.THINKING:
      return typeof block.thinking === "string" && block.thinking
        ? [{ thought: true, text: block.thinking }]
        : [];

    case CLAUDE_BLOCK.IMAGE: {
      const src = block.source || {};
      if (src.type === "base64" && src.media_type && src.data) {
        return [{ inlineData: { mimeType: src.media_type, data: src.data } }];
      }
      if (src.type === "url" && src.url) {
        return [{ fileData: { fileUri: src.url } }];
      }
      return [];
    }

    case CLAUDE_BLOCK.TOOL_USE:
      // Gemini 3+ rejects a functionCall part carrying no thoughtSignature, and
      // clients do not persist one in their history — so it is backfilled here,
      // exactly as the pivot route and executors/antigravity.js do. Omitting it
      // breaks multi-turn tool calling against plain `gemini`, whose default
      // executor does no backfill of its own.
      return [{
        thoughtSignature: DEFAULT_THINKING_AG_SIGNATURE,
        functionCall: {
          id: block.id,
          name: sanitizeName(block.name),
          args: block.input && typeof block.input === "object" ? block.input : {},
        },
      }];

    default:
      return [];
  }
}

// tool_result carries its payload as a string or as nested blocks.
function toolResultToPart(block, nameById) {
  const raw = Array.isArray(block.content)
    ? block.content.map((c) => (typeof c === "string" ? c : c?.text || "")).join("")
    : (typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""));

  let parsed = tryParseJSON(raw);
  if (parsed === null || typeof parsed !== "object") parsed = { result: raw };

  return {
    functionResponse: {
      id: block.tool_use_id,
      name: sanitizeName(nameById.get(block.tool_use_id) || block.tool_use_id || "tool"),
      // `is_error` is preserved rather than flattened: a failed tool call reads
      // differently to the model than a successful one returning an error string.
      response: block.is_error === true ? { error: parsed } : { result: parsed },
    },
  };
}

export function claudeToGeminiRequest(model, body) {
  const result = {
    model,
    contents: [],
    generationConfig: {},
    safetySettings: DEFAULT_SAFETY_SETTINGS,
  };

  if (body.temperature !== undefined) result.generationConfig.temperature = body.temperature;
  if (body.top_p !== undefined) result.generationConfig.topP = body.top_p;
  if (body.top_k !== undefined) result.generationConfig.topK = body.top_k;
  if (body.max_tokens !== undefined) result.generationConfig.maxOutputTokens = body.max_tokens;

  const systemParts = systemToParts(body.system);
  if (systemParts) result.systemInstruction = { role: GEMINI_ROLE.USER, parts: systemParts };

  // tool_use ids carry the name; tool_result only carries the id, and Gemini
  // wants the name on the response. Collected in one pass first because a result
  // can arrive in the same message list well after its call.
  const nameById = new Map();
  for (const msg of body.messages || []) {
    if (!Array.isArray(msg?.content)) continue;
    for (const b of msg.content) {
      if (b?.type === CLAUDE_BLOCK.TOOL_USE && b.id) nameById.set(b.id, b.name);
    }
  }

  for (const msg of body.messages || []) {
    if (!msg?.role) continue;
    const geminiRole = msg.role === ROLE.ASSISTANT ? GEMINI_ROLE.MODEL : GEMINI_ROLE.USER;

    if (typeof msg.content === "string") {
      result.contents.push({
        role: geminiRole,
        parts: msg.content ? [{ text: msg.content }] : emptyTurnParts(),
      });
      continue;
    }

    if (!Array.isArray(msg.content)) {
      result.contents.push({ role: geminiRole, parts: emptyTurnParts() });
      continue;
    }

    // A Claude user turn may hold tool_results and ordinary content together.
    // Gemini takes both as `user` parts, so they stay in one turn and in order.
    const parts = [];
    for (const block of msg.content) {
      if (block?.type === CLAUDE_BLOCK.TOOL_RESULT) parts.push(toolResultToPart(block, nameById));
      else parts.push(...blockToParts(block));
    }

    // Always pushed, even empty — see config/emptyTurn.js. This is the defect
    // the direct route exists to stop repeating.
    result.contents.push({ role: geminiRole, parts: parts.length > 0 ? parts : emptyTurnParts() });
  }

  result.contents = dropTrailingEmptyModelTurn(normalizeGeminiContents(result.contents));

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const functionDeclarations = [];
    for (const tool of body.tools) {
      if (!tool?.name) continue;
      const declaration = {
        name: sanitizeName(tool.name),
        description: tool.description || "",
      };
      // Cloned first: the cleaner mutates, and the request body outlives this
      // call — the combo cascade hands the same body to the next model on
      // failover, which would otherwise receive an already-rewritten schema.
      const schema = tool.input_schema || tool.inputSchema;
      if (schema) declaration.parameters = cleanJSONSchemaForAntigravity(structuredClone(schema));
      functionDeclarations.push(declaration);
    }
    if (functionDeclarations.length > 0) result.tools = [{ functionDeclarations }];
  }

  // Claude's extended thinking maps onto Gemini's thinking budget.
  const budget = body.thinking?.budget_tokens;
  if (body.thinking?.type === "enabled" && typeof budget === "number") {
    result.generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: budget };
  }

  // No `stream` field: the pivot route does not emit one either. Streaming is
  // chosen by the endpoint the executor calls (streamGenerateContent?alt=sse),
  // and an unknown top-level field is a rejected request, not an ignored one.
  return result;
}

register(FORMATS.CLAUDE, FORMATS.GEMINI, claudeToGeminiRequest, null);
