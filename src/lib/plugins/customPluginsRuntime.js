// Runtime interceptor for Custom Plugins (Image Vision, Think Deeper, Speed Mode)
//
// Plugins are REAL, not prompt injection:
//   - Image Vision: sets caps.vision = true on the request so the translator
//     keeps raw image blocks intact instead of stripping them. Any provider
//     that accepts image input (base64 / URL) will receive the images as-is.
//   - Think Deeper: sets native reasoning parameters (reasoning_effort,
//     thinking config) so the provider routes to its deepest reasoning tier.
//   - Speed Mode: sets native reasoning disabled parameters so the provider
//     skips all thinking/reasoning and returns the answer directly.

import { getSettings } from "@/lib/localDb";
import { FORMATS } from "open-sse/translator/formats.js";

// Default plugin state for fresh installs / missing settings
const DEFAULT_PLUGINS = {
  imageVision: { enabled: false, models: [] },
  thinkDeeper: { enabled: false, models: [] },
  speedMode: { enabled: false, models: [] },
};

// Cached plugin settings to avoid DB hits on every stream chunk
let cachedPlugins = null;
let lastFetch = 0;
const CACHE_TTL_MS = 2000;

async function getPluginConfig() {
  const now = Date.now();
  if (cachedPlugins && now - lastFetch < CACHE_TTL_MS) {
    return cachedPlugins;
  }
  try {
    const settings = await getSettings();
    cachedPlugins = settings?.customPlugins || DEFAULT_PLUGINS;
    lastFetch = now;
  } catch {
    cachedPlugins = DEFAULT_PLUGINS;
  }
  return cachedPlugins;
}

export function clearPluginCache() {
  cachedPlugins = null;
  lastFetch = 0;
}

function matchesModel(modelList, modelKey) {
  if (!Array.isArray(modelList) || !modelKey) return false;
  const key = String(modelKey).toLowerCase();
  const bare = key.includes("/") ? key.split("/").pop() : key;
  return modelList.some((m) => {
    const s = String(m).toLowerCase();
    const sBare = s.includes("/") ? s.split("/").pop() : s;
    return s === key || sBare === bare || s === bare || key === sBare;
  });
}

/**
 * Image Vision plugin — REAL implementation.
 *
 * Instead of converting images to fake text strings, we simply signal that
 * the model now supports vision. The chat pipeline (stripUnsupportedModalities)
 * will keep raw image blocks intact and the translator will format them for
 * the target provider (base64, URL, etc).
 *
 * For models that truly do not support vision at the provider level, the
 * upstream API may reject the request — but that is transparent and honest
 * rather than silently returning garbage extracted from JPEG binary.
 *
 * We add a lightweight system nudge so models that *can* read images know
 * to describe what they see.
 */
export function applyImageVision(body) {
  if (!body?.messages) return false;

  const hasImages = body.messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some(
        (b) =>
          b?.type === "image_url" ||
          b?.type === "image" ||
          (b?.type === "tool_result" && Array.isArray(b.content) &&
            b.content.some((c) => c?.type === "image_url" || c?.type === "image"))
      )
  );

  if (hasImages) {
    // Add a concise instruction so the model focuses on visual content
    if (body.system && typeof body.system === "string") {
      if (!body.system.includes("Image Vision")) {
        body.system = "Image Vision is active: process all attached images and answer questions about their visual content.\n\n" + body.system;
      }
    } else if (Array.isArray(body.messages)) {
      const sysIdx = body.messages.findIndex((m) => m.role === "system");
      if (sysIdx >= 0) {
        const sys = body.messages[sysIdx].content;
        const txt = typeof sys === "string" ? sys : (Array.isArray(sys) && sys[0]?.type === "text" ? sys[0].text : "");
        if (txt && !txt.includes("Image Vision")) {
          const prefix = "Image Vision is active: process all attached images and answer questions about their visual content.\n\n";
          if (typeof sys === "string") {
            body.messages[sysIdx].content = prefix + sys;
          } else if (Array.isArray(sys) && sys[0]?.type === "text") {
            sys[0].text = prefix + sys[0].text;
          }
        }
      }
    }
  }

  return true; // always signal vision active — images pass through to translator
}

/**
 * Think Deeper plugin — REAL implementation.
 *
 * Sets native reasoning parameters so the provider routes to its deepest
 * reasoning tier. Uses the same params the 9Router thinking pipeline reads.
 */
export function applyThinkDeeper(body, sourceFormat) {
  if (!body) return;

  // Provider-native reasoning depth parameters
  if (sourceFormat === FORMATS.CLAUDE) {
    // Claude uses thinking object
    body.thinking = {
      type: "enabled",
      budget_tokens: body.thinking?.budget_tokens || 10240,
    };
  } else {
    // OpenAI / OpenAI-compatible
    body.reasoning_effort = "high";
    // Some providers use these alternate fields
    if (!body.reasoning) {
      body.reasoning = { effort: "high" };
    }
  }
}

/**
 * Speed Mode plugin — REAL implementation.
 *
 * Uses native reasoning-disable parameters. Skips thinking entirely
 * so responses come back instantly without any chain-of-thought overhead.
 */
export function applySpeedMode(body, sourceFormat) {
  if (!body) return;

  if (sourceFormat === FORMATS.CLAUDE) {
    body.thinking = { type: "disabled" };
    delete body.reasoning_effort;
  } else {
    body.reasoning_effort = "none";
    if (body.thinking && typeof body.thinking === "object") {
      delete body.thinking.budget_tokens;
    }
  }
  delete body.enable_thinking;
  delete body.thinking_budget;
}

/**
 * Check and execute active custom plugins for the target model.
 * Returns capability flags so chatCore can update caps before stripping.
 */
export async function applyCustomPlugins(body, provider, model, sourceFormat, requestedModel) {
  const config = await getPluginConfig();
  const keysToTest = [
    requestedModel,
    `${provider}/${model}`,
    model,
  ].filter(Boolean);

  if (requestedModel && requestedModel.includes("/")) {
    keysToTest.push(requestedModel.split("/").pop());
  }

  const checkMatch = (modelList) => {
    return keysToTest.some((key) => matchesModel(modelList, key));
  };

  let isVisionActive = false;
  let isThinkDeeperActive = false;
  let isSpeedModeActive = false;

  if (config.imageVision?.enabled && checkMatch(config.imageVision.models)) {
    isVisionActive = true;
    applyImageVision(body);
  }

  if (config.thinkDeeper?.enabled && checkMatch(config.thinkDeeper.models)) {
    isThinkDeeperActive = true;
    applyThinkDeeper(body, sourceFormat);
  }

  if (config.speedMode?.enabled && checkMatch(config.speedMode.models)) {
    isSpeedModeActive = true;
    applySpeedMode(body, sourceFormat);
  }

  return { isVisionActive, isThinkDeeperActive, isSpeedModeActive };
}
