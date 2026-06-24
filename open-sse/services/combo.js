/**
 * Shared combo (model combo) handling with fallback support
 */

import { createHash } from "node:crypto";
import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? m.slice(0, slash) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  const reordered = models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);

  return reordered.every((m, i) => m === models[i]) ? models : reordered;
}

const TASK_LEVEL_WEIGHT = {
  light: 1,
  standard: 2,
  heavy: 3,
  critical: 4,
};

const TASK_TARGET_POWER = {
  light: 35,
  standard: 65,
  heavy: 95,
  critical: 120,
};

const LIGHT_TASK_RE = /\b(hi|hello|thanks|thank you|ping|format|rewrite|grammar|translate|summari[sz]e|short|quick|one[- ]?liner|explain briefly)\b/i;
const HEAVY_TASK_RE = /\b(debug|root cause|architecture|architectural|refactor|migrate|implementation|implement|design|analy[sz]e|investigate|compare|benchmark|whitebox|codebase|end[- ]?to[- ]?end|e2e)\b/i;
const CRITICAL_TASK_RE = /\b(critical|security|vulnerability|exploit|rce|remote code execution|supply chain|account takeover|auth bypass|privilege escalation|tenant|cross[- ]tenant|sandbox escape|ssrf|deserialization|prod incident|data exfiltration|bug bounty)\b/i;

function splitModelString(modelStr) {
  const slash = typeof modelStr === "string" ? modelStr.indexOf("/") : -1;
  return {
    provider: slash > 0 ? modelStr.slice(0, slash) : "",
    model: slash > 0 ? modelStr.slice(slash + 1) : String(modelStr || ""),
  };
}

function getModelCapabilities(modelStr) {
  const { provider, model } = splitModelString(modelStr);
  return getCapabilitiesForModel(provider, model);
}

function taskWeight(level) {
  return TASK_LEVEL_WEIGHT[level] || TASK_LEVEL_WEIGHT.standard;
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

/**
 * Keep chat-like traffic on the same first model so provider-side prompt caches
 * keep hitting. New conversations still use round-robin for distribution.
 * @type {Map<string, { index: number, lastUsed: number }>}
 */
const comboConversationAffinity = new Map();
const CONVERSATION_AFFINITY_TTL_MS = 60 * 60 * 1000;
const MAX_CONVERSATION_AFFINITY_ENTRIES = 1000;

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf) are scanned
// only on the current user turn; "search" is request-wide (lives in tools).
// Returns a Set of: "vision" | "pdf" | "search".
export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "file" || t === "document" || t === "input_file") required.add("pdf");
    // gemini parts: inlineData/fileData carry a mime
    const mime = b.inlineData?.mimeType || b.fileData?.mimeType;
    if (typeof mime === "string" && mime.startsWith("image/")) required.add("vision");
    if (mime === "application/pdf") required.add("pdf");
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages)) scanContent(m.content);      // openai / claude
  for (const it of trailingUserItems(body.input)) scanContent(it.content);       // responses
  const contents = body.contents || body.request?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents)) scanContent(c.parts);

  for (const tool of body.tools || []) {
    const type = tool?.type || tool?.function?.name || tool?.name;
    if (typeof type === "string" && /^web_search/.test(type)) required.add("search");
  }

  const effort = body.reasoning_effort || body.reasoning?.effort;
  if (effort && String(effort).toLowerCase() !== "none") required.add("reasoning");
  if (isHeavyRequest(body)) required.add("reasoning");

  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

function getRotationState(rotationKey) {
  const existingState = comboRotationState.get(rotationKey);
  return typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });
}

function advanceRotationState(rotationKey, currentIndex, modelCount, normalizedStickyLimit, consecutiveUseCount) {
  const nextUseCount = consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % modelCount,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }
}

function pruneConversationAffinity(now = Date.now()) {
  for (const [key, value] of comboConversationAffinity) {
    if (!value || now - value.lastUsed > CONVERSATION_AFFINITY_TTL_MS) {
      comboConversationAffinity.delete(key);
    }
  }

  while (comboConversationAffinity.size > MAX_CONVERSATION_AFFINITY_ENTRIES) {
    const oldestKey = comboConversationAffinity.keys().next().value;
    comboConversationAffinity.delete(oldestKey);
  }
}

function normalizeFingerprintText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

function collectText(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return out;
  }
  if (typeof value !== "object") return out;

  if (typeof value.text === "string") out.push(value.text);
  if (typeof value.input_text === "string") out.push(value.input_text);
  if (typeof value.output_text === "string") out.push(value.output_text);
  if (typeof value.content === "string") out.push(value.content);
  else if (Array.isArray(value.content)) collectText(value.content, out);
  if (Array.isArray(value.parts)) collectText(value.parts, out);
  if (typeof value.query === "string") out.push(value.query);
  if (typeof value.url === "string") out.push(value.url);

  return out;
}

function estimatePromptChars(body) {
  const contents = body.contents || body.request?.contents;
  const parts = [
    body.system,
    body.instructions,
    body.messages,
    body.input,
    contents,
    body.query,
    body.url,
  ];
  return collectText(parts).join("\n").length;
}

function countMessages(body) {
  return (Array.isArray(body.messages) ? body.messages.length : 0) +
    (Array.isArray(body.input) ? body.input.length : 0) +
    (Array.isArray(body.contents) ? body.contents.length : 0) +
    (Array.isArray(body.request?.contents) ? body.request.contents.length : 0);
}

function maxRequestedOutput(body) {
  const candidates = [
    body.max_tokens,
    body.max_output_tokens,
    body.max_completion_tokens,
    body.generationConfig?.maxOutputTokens,
  ].map((v) => Number.parseInt(v, 10)).filter((v) => Number.isFinite(v));
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function getTaskText(body) {
  const contents = body?.contents || body?.request?.contents;
  return collectText([
    body?.system,
    body?.instructions,
    body?.messages,
    body?.input,
    contents,
    body?.query,
    body?.url,
  ]).join("\n");
}

function normalizeEffort(body) {
  return String(body?.reasoning_effort || body?.reasoning?.effort || "").toLowerCase();
}

function getTaskSignals(body) {
  const promptChars = estimatePromptChars(body || {});
  const messageCount = countMessages(body || {});
  const toolCount = Array.isArray(body?.tools) ? body.tools.length : 0;
  const outputTokens = maxRequestedOutput(body || {});
  const effort = normalizeEffort(body);
  const text = getTaskText(body || {});

  return {
    promptChars,
    messageCount,
    toolCount,
    outputTokens,
    effort,
    hasExplicitReasoning: Boolean(effort && effort !== "none" && effort !== "off" && effort !== "disabled"),
    lightKeyword: LIGHT_TASK_RE.test(text),
    heavyKeyword: HEAVY_TASK_RE.test(text),
    criticalKeyword: CRITICAL_TASK_RE.test(text),
  };
}

/**
 * Classify request difficulty for smart combo routing.
 *
 * This deliberately uses cheap, local signals only. It is not a semantic judge;
 * it is a routing hint so light requests stay on fast/cheap models while large,
 * tool-heavy, security-sensitive, or reasoning-heavy requests try stronger
 * models first. Fallback still tries every model.
 */
export function classifyTask(body) {
  const s = getTaskSignals(body || {});
  const reasons = [];
  const add = (condition, reason) => {
    if (condition) reasons.push(reason);
    return condition;
  };

  const effortIsHigh = /^(high|xhigh|max|maximum|hard|deep)$/.test(s.effort);
  const effortIsLight = !s.hasExplicitReasoning || /^(low|minimal|none|off|disabled)$/.test(s.effort);

  const critical =
    add(s.promptChars >= 100000, "huge-context") ||
    add(s.outputTokens >= 32768, "huge-output") ||
    add(s.toolCount >= 8 && s.promptChars >= 16000, "many-tools-large-context") ||
    add(s.criticalKeyword && (effortIsHigh || s.toolCount >= 3 || s.promptChars >= 8000), "critical-domain");

  if (critical) {
    return { level: "critical", weight: taskWeight("critical"), ...s, reasons };
  }

  const heavySignalCount = [
    add(s.promptChars >= 50000, "large-context"),
    add(s.promptChars >= 24000, "medium-large-context"),
    add(s.messageCount >= 16, "long-conversation"),
    add(s.toolCount >= 4, "many-tools"),
    add(s.outputTokens >= 8192, "large-output"),
    add(effortIsHigh, "high-reasoning-effort"),
    add(s.criticalKeyword, "security-sensitive"),
    add(s.heavyKeyword && s.promptChars >= 4000, "complex-task"),
  ].filter(Boolean).length;

  if (heavySignalCount >= 2 || s.promptChars >= 50000 || effortIsHigh) {
    return { level: "heavy", weight: taskWeight("heavy"), ...s, reasons };
  }

  const light =
    s.promptChars <= 2000 &&
    s.messageCount <= 3 &&
    s.toolCount === 0 &&
    s.outputTokens <= 1500 &&
    effortIsLight &&
    !s.criticalKeyword &&
    !s.heavyKeyword;

  if (light || (s.lightKeyword && s.promptChars <= 4000 && s.toolCount === 0 && effortIsLight && !s.criticalKeyword)) {
    return { level: "light", weight: taskWeight("light"), ...s, reasons: reasons.length ? reasons : ["small-simple-request"] };
  }

  return { level: "standard", weight: taskWeight("standard"), ...s, reasons: reasons.length ? reasons : ["default"] };
}

function modelPowerScore(modelStr) {
  const { model } = splitModelString(modelStr);
  const id = `${modelStr || ""} ${model || ""}`.toLowerCase();
  const caps = getModelCapabilities(modelStr);

  let score = 35;
  if (caps.reasoning) score += 18;
  if (caps.search) score += 4;
  if (caps.tools) score += 3;
  if (caps.vision) score += 3;

  if (caps.contextWindow >= 1000000) score += 22;
  else if (caps.contextWindow >= 400000) score += 15;
  else if (caps.contextWindow >= 200000) score += 9;
  else if (caps.contextWindow <= 32000) score -= 10;

  if (caps.maxOutput >= 128000) score += 12;
  else if (caps.maxOutput >= 64000) score += 8;
  else if (caps.maxOutput <= 8192) score -= 8;

  if (/\b(opus|mythos|gpt-5|o3|o4|pro|max|ultra|deepseek-v4-pro|sonnet-4|glm-5|kimi-k2\.7|minimax-m3|reasoner)\b/i.test(id)) score += 28;
  if (/\b(coder|code|coding)\b/i.test(id)) score += 8;
  if (/\b(haiku|flash|mini|lite|small|nano|instant|fast|turbo|3\.5|8b|7b)\b/i.test(id)) score -= 24;

  return Math.max(0, Math.min(150, score));
}

export function scoreModelForTask(modelStr, task = classifyTask({}), required = new Set()) {
  const caps = getModelCapabilities(modelStr);
  const target = TASK_TARGET_POWER[task.level] || TASK_TARGET_POWER.standard;
  const power = modelPowerScore(modelStr);
  let score = 100 - Math.abs(power - target);

  const hard = [...(required || [])].filter((c) => HARD_CAPS.has(c));
  if (!hard.every((c) => caps[c] === true)) score -= 10000;

  if ((required?.has?.("reasoning") || task.weight >= TASK_LEVEL_WEIGHT.heavy) && !caps.reasoning) score -= 120;
  if (required?.has?.("search") && !caps.search) score -= 30;

  const estimatedPromptTokens = Math.ceil((task.promptChars || 0) / 4);
  if (caps.contextWindow && estimatedPromptTokens > caps.contextWindow * 0.85) score -= 200;
  if (caps.maxOutput && task.outputTokens && task.outputTokens > caps.maxOutput) score -= 80;

  if (task.level === "light" && power > 95) score -= 35;
  if (task.level === "standard" && power > 125) score -= 10;
  if (task.level === "heavy" && power < 65) score -= 60;
  if (task.level === "critical" && power < 85) score -= 100;

  return score;
}

export function reorderByTaskWeight(models, task = classifyTask({}), required = new Set()) {
  if (!Array.isArray(models) || models.length <= 1) return models;

  const reordered = models
    .map((m, i) => ({ m, i, score: scoreModelForTask(m, task, required) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.m);

  return reordered.every((m, i) => m === models[i]) ? models : reordered;
}

function isHeavyRequest(body) {
  return classifyTask(body).weight >= TASK_LEVEL_WEIGHT.heavy;
}

function firstRoleText(items, roles, contentKey = "content") {
  if (!Array.isArray(items)) return "";
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (!roles.has(item.role)) continue;
    const content = contentKey === "parts" ? item.parts : item.content;
    const text = normalizeFingerprintText(collectText(content).join("\n"));
    if (text) return text;
  }
  return "";
}

function allRoleText(items, roles, contentKey = "content") {
  if (!Array.isArray(items)) return "";
  return normalizeFingerprintText(items
    .filter((item) => item && typeof item === "object" && roles.has(item.role))
    .map((item) => collectText(contentKey === "parts" ? item.parts : item.content).join("\n"))
    .filter(Boolean)
    .join("\n"));
}

function hashConversationSeed(seed) {
  const normalized = normalizeFingerprintText(seed);
  if (!normalized) return null;
  return createHash("sha1").update(normalized).digest("hex").slice(0, 24);
}

/**
 * Derive a stable cache-affinity key from explicit thread metadata when present,
 * otherwise from the immutable start of the prompt (system + first user turn).
 * Appended turns should not move an existing conversation to another model.
 */
export function getConversationCacheKey(body) {
  if (!body || typeof body !== "object") return null;

  const explicitCandidates = [
    body.conversation_id,
    body.conversationId,
    body.thread_id,
    body.threadId,
    body.session_id,
    body.sessionId,
    body.metadata?.conversation_id,
    body.metadata?.conversationId,
    body.metadata?.thread_id,
    body.metadata?.threadId,
    body.metadata?.session_id,
    body.metadata?.sessionId,
  ];
  const explicit = explicitCandidates.find((v) => v != null && String(v).trim());
  if (explicit != null) return hashConversationSeed(`explicit:${String(explicit).trim()}`);

  const systemRoles = new Set(["system", "developer"]);
  const userRoles = new Set(["user"]);
  const contents = body.contents || body.request?.contents;

  const seedParts = [
    collectText(body.system).join("\n"),
    collectText(body.instructions).join("\n"),
    allRoleText(body.messages, systemRoles),
    allRoleText(body.input, systemRoles),
    allRoleText(contents, systemRoles, "parts"),
    firstRoleText(body.messages, userRoles),
    typeof body.input === "string" ? body.input : firstRoleText(body.input, userRoles),
    firstRoleText(contents, userRoles, "parts"),
    body.query,
    body.url,
  ].filter(Boolean);

  return hashConversationSeed(seedParts.join("\n"));
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @param {string|null} [conversationCacheKey=null] - Stable key used to keep a conversation on one model
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1, conversationCacheKey = null) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const state = getRotationState(rotationKey);

  const currentIndex = state.index % models.length;
  if (conversationCacheKey) {
    const now = Date.now();
    pruneConversationAffinity(now);

    const affinityKey = `${rotationKey}:${conversationCacheKey}`;
    const affinity = comboConversationAffinity.get(affinityKey);
    if (affinity) {
      const pinnedIndex = affinity.index % models.length;
      comboConversationAffinity.delete(affinityKey);
      comboConversationAffinity.set(affinityKey, { index: pinnedIndex, lastUsed: now });
      return rotateModelsFromIndex(models, pinnedIndex);
    }

    comboConversationAffinity.set(affinityKey, { index: currentIndex, lastUsed: now });
  }

  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  advanceRotationState(rotationKey, currentIndex, models.length, normalizedStickyLimit, state.consecutiveUseCount);

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) {
    comboRotationState.delete(comboName);
    const prefix = `${comboName}:`;
    for (const key of comboConversationAffinity.keys()) {
      if (key.startsWith(prefix)) comboConversationAffinity.delete(key);
    }
  } else {
    comboRotationState.clear();
    comboConversationAffinity.clear();
  }
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true }) {
  // Apply rotation strategy if enabled
  const conversationCacheKey = getConversationCacheKey(body);
  let rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit, conversationCacheKey);

  // Auto-switch: first satisfy hard request capabilities, then route by task weight.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }

    const task = classifyTask(body);
    const taskReordered = reorderByTaskWeight(rotatedModels, task, required);
    if (taskReordered[0] !== rotatedModels[0]) {
      const reasons = Array.isArray(task.reasons) && task.reasons.length ? ` (${task.reasons.join(",")})` : "";
      log.info("COMBO", `smart-route task=${task.level}${reasons} → ${taskReordered[0]}`);
    }
    rotatedModels = taskReordered;
  }
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);
      
      // Success (2xx) - return response
      if (result.ok) {
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      // Extract error info from response
      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // Check if should fallback to next model
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  // OpenAI chat completion
  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

/**
 * Append a synthesized user turn to whichever message array the request format uses.
 * Preserves the original conversation + system prompt so the judge has full context.
 */
function appendUserTurn(body, text) {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].
const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

// Resolve a Response (or {__error}) within ms; the loser keeps running but is ignored.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          if (out[i] && out[i].ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Panel model strings
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {string} [options.judgeModel] - Judge model; falls back to panel[0]
 * @param {Object} [options.tuning] - Override FUSION_DEFAULTS (minPanel, grace, timeout)
 * @returns {Promise<Response>}
 */
export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // 1. Fan out to the panel in parallel: non-streaming, tools stripped (we want prose).
  const { tools, tool_choice, ...rest } = body;
  const panelBody = { ...rest, stream: false };

  // Flatten tool turns to prose so panel models keep context without emitting tool_calls.
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  const calls = panel.map((m) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    if (!res.ok) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status }); continue; }
    try {
      const json = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    log.info("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0].model);
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
