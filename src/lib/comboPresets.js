/**
 * Build Cursor / Claude default combo presets.
 * Combo names match client-native model IDs (no provider prefix);
 * each is seeded with the matching prefixed 9router model so routing works.
 */

import { getProviderModels } from "open-sse/config/providerModels.js";
import { CLI_TOOLS } from "@/shared/constants/cliTools";

export const VALID_COMBO_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
export const PRESET_SOURCES = new Set(["cursor", "claude"]);

const CURSOR_ALIAS = "cu";
const CLAUDE_ALIAS = "cc";

/** Extra Claude Code aliases not listed in defaultModels. */
const CLAUDE_EXTRA_ALIAS_TARGETS = {
  default: "cc/claude-sonnet-5",
  opusplan: "cc/claude-opus-5",
};

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isValidComboPresetName(name) {
  return typeof name === "string" && name.length > 0 && VALID_COMBO_NAME_REGEX.test(name);
}

/**
 * @param {string} name
 * @param {string[]} models
 * @param {Set<string>} [seen]
 * @returns {{ name: string, models: string[] }|null}
 */
function pushItem(name, models, seen) {
  if (!isValidComboPresetName(name)) return null;
  if (seen?.has(name)) return null;
  if (!Array.isArray(models) || models.length === 0) return null;
  seen?.add(name);
  return { name, models };
}

/**
 * @param {Array<{id?: string}|string>} modelList
 * @param {string} providerAlias
 * @param {Set<string>} seen
 * @returns {{ name: string, models: string[] }[]}
 */
function itemsFromProviderModels(modelList, providerAlias, seen) {
  const out = [];
  for (const entry of modelList || []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!id) continue;
    const item = pushItem(id, [`${providerAlias}/${id}`], seen);
    if (item) out.push(item);
  }
  return out;
}

/**
 * Build Cursor default presets.
 * Prefer live catalog when provided; otherwise static cu registry.
 * @param {{ liveModels?: Array<{id: string}|string> }} [opts]
 * @returns {{ name: string, models: string[] }[]}
 */
export function buildCursorPresetItems(opts = {}) {
  const seen = new Set();
  const live = Array.isArray(opts.liveModels) ? opts.liveModels : null;
  if (live?.length) {
    return itemsFromProviderModels(live, CURSOR_ALIAS, seen);
  }
  return itemsFromProviderModels(getProviderModels(CURSOR_ALIAS), CURSOR_ALIAS, seen);
}

/**
 * Build Claude default presets from cc registry + Claude Code aliases.
 * @returns {{ name: string, models: string[] }[]}
 */
export function buildClaudePresetItems() {
  const seen = new Set();
  const out = itemsFromProviderModels(getProviderModels(CLAUDE_ALIAS), CLAUDE_ALIAS, seen);

  const claudeTool = CLI_TOOLS.claude || {};
  for (const entry of claudeTool.defaultModels || []) {
    const name = entry.alias || entry.id;
    const target = entry.defaultValue;
    if (!name || !target) continue;
    const item = pushItem(name, [target], seen);
    if (item) out.push(item);
  }

  for (const alias of claudeTool.modelAliases || []) {
    if (seen.has(alias)) continue;
    const target = CLAUDE_EXTRA_ALIAS_TARGETS[alias];
    if (!target) continue;
    const item = pushItem(alias, [target], seen);
    if (item) out.push(item);
  }

  return out;
}

/**
 * @param {"cursor"|"claude"} source
 * @param {{ liveModels?: Array<{id: string}|string>, existingNames?: Iterable<string> }} [opts]
 * @returns {{ name: string, models: string[], exists: boolean }[]}
 */
export function buildPresetItems(source, opts = {}) {
  if (!PRESET_SOURCES.has(source)) return [];

  const items = source === "cursor"
    ? buildCursorPresetItems({ liveModels: opts.liveModels })
    : buildClaudePresetItems();

  const existing = new Set(opts.existingNames || []);
  return items.map((item) => ({
    ...item,
    exists: existing.has(item.name),
  }));
}
