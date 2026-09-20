import { AUTO_ROUTING_DEFAULTS, AUTO_ROUTING_PROMPT, AUTO_ROUTING_TIERS, validateAutoRouting } from "../config/autoRouting.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../translator/schema/index.js";
import { detectRequiredCapabilities, handleComboChat, reorderByCapabilities } from "./combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping } from "./capacityAdapter.js";

function textOnly(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block && !block.thought && (
    [OPENAI_BLOCK.TEXT, RESPONSES_ITEM.INPUT_TEXT, RESPONSES_ITEM.OUTPUT_TEXT].includes(block.type)
    || (!block.type && typeof block.text === "string")
  )).map((block) => block.text || "").join("\n");
}

function clip(text, limit) {
  const marker = "...[truncated]";
  return text.length > limit ? text.slice(0, Math.max(0, limit - marker.length)) + marker.slice(0, limit) : text;
}

export function buildClassificationContext(body) {
  const raw = body.messages || (Array.isArray(body.input) ? body.input : null)
    || body.contents || body.request?.contents || [];
  const turns = [];
  let system = textOnly(body.system || body.instructions || body.systemInstruction?.parts || body.request?.systemInstruction?.parts);
  for (const message of raw) {
    if (!message || (message.type && message.type !== RESPONSES_ITEM.MESSAGE)) continue;
    const role = message.role === GEMINI_ROLE.MODEL ? ROLE.ASSISTANT : message.role;
    const text = textOnly(message.content ?? message.parts).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim();
    if (!text) continue;
    if (role === ROLE.SYSTEM || role === ROLE.DEVELOPER) system = text;
    else if (role === ROLE.USER || role === ROLE.ASSISTANT) turns.push({ role, text });
  }
  if (typeof body.input === "string" && body.input.trim()) turns.push({ role: ROLE.USER, text: body.input.trim() });
  const askIndex = turns.findLastIndex((turn) => turn.role === ROLE.USER);
  if (askIndex < 0) return null;
  let remaining = AUTO_ROUTING_DEFAULTS.historyChars;
  const history = [];
  for (let i = askIndex - 1; i >= 0 && history.length < AUTO_ROUTING_DEFAULTS.historyTurns && remaining > 0; i--) {
    const text = clip(turns[i].text, remaining);
    history.unshift({ role: turns[i].role, text });
    remaining -= text.length;
  }
  return {
    currentAsk: clip(turns[askIndex].text, AUTO_ROUTING_DEFAULTS.askChars),
    recentConversation: history,
    callerSystemContext: clip(system, AUTO_ROUTING_DEFAULTS.systemChars),
    requiredCapabilities: [...detectRequiredCapabilities(body)],
  };
}

export function parseClassifiedTier(json) {
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Classifier returned no text");
  const result = JSON.parse(text);
  if (!result || Object.keys(result).length !== 1 || !AUTO_ROUTING_TIERS.some(({ id }) => id === result.tier)) {
    throw new Error("Classifier returned an invalid tier");
  }
  return result.tier;
}

export async function classifyRequest({ body, config, classify, signal }) {
  const invalid = validateAutoRouting(config);
  if (invalid) throw new Error(invalid);
  const context = buildClassificationContext(body);
  if (!context) throw new Error("No usable human ask");
  const controller = new AbortController();
  let timer;
  let onAbort;
  const cancellation = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new Error("Client cancelled classification"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Classifier timed out"));
    }, config.timeoutMs ?? AUTO_ROUTING_DEFAULTS.timeoutMs);
  });
  try {
    return await Promise.race([cancellation, (async () => {
      controller.signal.throwIfAborted();
      const response = await classify({
        model: config.classifierModel,
        stream: false,
        max_tokens: AUTO_ROUTING_DEFAULTS.maxOutputTokens,
        messages: [
          { role: ROLE.SYSTEM, content: AUTO_ROUTING_PROMPT },
          { role: ROLE.USER, content: JSON.stringify(context) },
        ],
      }, config.classifierModel, controller.signal);
      if (!response.ok) throw new Error(`Classifier failed (${response.status})`);
      return parseClassifiedTier(await response.json());
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function handleAutoRoutingChat({ body, models, config, classify, handleSingleModel, settings, log, comboName, signal }) {
  let tier = null;
  const started = Date.now();
  try {
    tier = await classifyRequest({ body, config, classify, signal });
    log.info("AUTO-ROUTING", `Combo "${comboName}" | classifier=${config.classifierModel} | tier=${tier} | ${Date.now() - started}ms`);
  } catch (error) {
    log.warn("AUTO-ROUTING", `Combo "${comboName}" | classifier=${config?.classifierModel || "unset"} | fallback=${error.message} | ${Date.now() - started}ms`);
  }
  const required = detectRequiredCapabilities(body);
  const tierModels = tier ? config.tiers[tier] : [];
  const adapterModels = new Set();
  const candidates = [];
  const appendPool = (pool) => {
    const augmented = augmentModelsWithCapacityAdapter(pool, required, settings);
    for (const model of reorderByCapabilities(augmented, required)) {
      if (candidates.includes(model)) continue;
      candidates.push(model);
      if (!pool.includes(model)) adapterModels.add(model);
    }
  };
  // Order each stage separately so emergency models cannot outrank a healthy tier.
  appendPool(tierModels);
  appendPool(models);
  const execute = withCapacityAdapterStripping(handleSingleModel, [...adapterModels]);
  return handleComboChat({
    body, models: candidates, log, comboName, comboStrategy: "fallback", autoSwitch: false, signal,
    handleSingleModel: (original, model) => execute(structuredClone(original), model),
  });
}
