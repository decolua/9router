import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import codexProvider from "open-sse/providers/registry/codex.js";

const execAsync = promisify(exec);

// Codex CLI validates catalog entries strictly and each one carries a
// version-specific system prompt (base_instructions / model_messages), so
// 9Router entries are cloned from Codex's own bundled catalog, never synthesized.
const BUNDLED_CATALOG_COMMAND = "codex debug models --bundled";
const BUNDLED_CATALOG_TIMEOUT_MS = 15000;
// Bundled dump is ~450KB and grows with every Codex release
const BUNDLED_CATALOG_MAX_BUFFER = 16 * 1024 * 1024;

const isValidEntry = (entry) =>
  entry && typeof entry === "object" && typeof entry.slug === "string" && entry.slug !== "";

// Preferred fallback template: a plain shell-tool entry. Code-mode entries
// (gpt-6-astra, gpt-5.6-*) expose tools like mcp__cua_repl that Codex rejects
// as "unsupported call" when a non-Codex model tries to use them.
const DEFAULT_TEMPLATE_SLUG = "gpt-5.5";

// Model prefixes that route to the real Codex upstream, from the registry
const CODEX_PROVIDER_PREFIXES = new Set(
  [codexProvider.id, codexProvider.alias, codexProvider.uiAlias].filter(Boolean)
);

// Code-mode / responses-lite behavior only the Codex upstream understands.
// multi_agent_reasoning_effort is only set alongside multi_agent_version v2.
const CODE_MODE_OVERRIDES = {
  tool_mode: null,
  use_responses_lite: false,
  multi_agent_version: null,
  multi_agent_reasoning_effort: null,
  experimental_supported_tools: [],
};

const isCodeModeEntry = (entry) =>
  entry.tool_mode === "code_mode_only" || entry.use_responses_lite === true;

// gpt-5.5 if bundled, else the first plain listed entry, else the entry Codex
// itself leads its picker with (lowest-priority listed)
const pickDefaultTemplate = (entries) => {
  const preferred = entries.find((e) => e.slug === DEFAULT_TEMPLATE_SLUG);
  if (preferred) return preferred;
  const byPriority = (a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity);
  const listed = entries.filter((e) => e.visibility === "list").sort(byPriority);
  const plain = listed.find((e) => !isCodeModeEntry(e));
  if (plain) return plain;
  if (listed.length) return listed[0];
  return [...entries].sort(byPriority)[0] || null;
};

// Unprefixed ids (combos) and every other provider are non-Codex
const isCodexProviderModel = (id) => {
  const slash = id.indexOf("/");
  return slash > 0 && CODEX_PROVIDER_PREFIXES.has(id.slice(0, slash));
};

// Accept plain ids or /v1/models entries ({ id, context_length })
const normalizeModel = (model) => {
  if (typeof model === "string") return { id: model.trim(), contextLength: null };
  if (model && typeof model.id === "string") {
    return {
      id: model.id.trim(),
      contextLength: Number.isFinite(model.context_length) ? model.context_length : null,
    };
  }
  return null;
};

/**
 * Build a Codex `model_catalog_json` document listing 9Router models.
 * Each 9Router model clones the bundled entry whose slug matches the part after
 * the last "/" (mirbud/gpt-5.6-terra → gpt-5.6-terra), else the default template.
 * Bundled entries are kept but hidden so internal slugs still resolve.
 * @param {{ models: object[] }} bundledCatalog - Output of `codex debug models --bundled`.
 * @param {Array<string|{id: string, context_length?: number}>} models - 9Router model ids in display order.
 * @returns {{ models: object[] }}
 */
export function buildCodexModelCatalog(bundledCatalog, models) {
  const bundled = (Array.isArray(bundledCatalog?.models) ? bundledCatalog.models : []).filter(isValidEntry);
  const defaultTemplate = pickDefaultTemplate(bundled);
  if (!defaultTemplate) return { models: [] };

  const bySlug = new Map(bundled.map((e) => [e.slug, e]));
  const routerEntries = [];
  const seen = new Set();

  for (const raw of Array.isArray(models) ? models : []) {
    const model = normalizeModel(raw);
    if (!model?.id || seen.has(model.id)) continue;
    seen.add(model.id);

    const baseSlug = model.id.slice(model.id.lastIndexOf("/") + 1);
    const matched = bySlug.get(baseSlug);
    const entry = structuredClone(matched || defaultTemplate);

    entry.slug = model.id;
    entry.display_name = model.id;
    entry.description = matched
      ? `${model.id} via 9Router`
      : `${model.id} via 9Router (Codex profile: ${defaultTemplate.slug})`;
    entry.visibility = "list";
    entry.priority = routerEntries.length + 1;
    // Retirement notices point at bare OpenAI slugs, which 9Router can't route;
    // an inherited upgrade would push the user off a working prefixed model.
    entry.upgrade = null;
    entry.availability_nux = null;

    // Non-Codex upstreams get the plain shell toolset even when the name
    // matches a code-mode bundled model (e.g. kr/gpt-5.6-terra)
    if (!isCodexProviderModel(model.id)) Object.assign(entry, structuredClone(CODE_MODE_OVERRIDES));

    if (!matched) {
      // OpenAI service tiers (Fast/priority) don't exist on arbitrary upstreams
      entry.service_tiers = [];
      entry.additional_speed_tiers = [];
      // Template window belongs to a GPT model; prefer 9Router's own figure so
      // Codex compacts at the right point instead of overflowing upstream.
      if (model.contextLength) {
        entry.context_window = model.contextLength;
        entry.max_context_window = model.contextLength;
      }
    }

    routerEntries.push(entry);
  }

  // Shift hidden entries past the 9Router block, keeping their relative order
  const offset = routerEntries.length + 1;
  const hiddenBundled = bundled
    .filter((e) => !seen.has(e.slug))
    .map((e) => ({
      ...structuredClone(e),
      visibility: "hide",
      priority: offset + Math.max(0, Number.isFinite(e.priority) ? e.priority : 0),
    }));

  return { models: [...routerEntries, ...hiddenBundled] };
}

/**
 * Load Codex's bundled model catalog by running the installed CLI.
 * Throws when codex isn't runnable or the output isn't a catalog.
 */
export async function loadBundledCodexCatalog() {
  const isWindows = os.platform() === "win32";
  const env = isWindows
    ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
    : process.env;
  const { stdout } = await execAsync(BUNDLED_CATALOG_COMMAND, {
    windowsHide: true,
    env,
    timeout: BUNDLED_CATALOG_TIMEOUT_MS,
    maxBuffer: BUNDLED_CATALOG_MAX_BUFFER,
  });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed?.models) || parsed.models.length === 0) {
    throw new Error("Codex bundled catalog has no models");
  }
  return parsed;
}
