// Pi model entries for the `9router` provider in ~/.pi/agent/models.json.
//
// The CLI tools card and the settings route must agree on which fields a model
// entry carries and how they are validated, so both read this module instead of
// keeping their own copies. Pi's schema (docs/models-configuration.md): `input`
// is ("text" | "image")[], `reasoning` says whether the model thinks at all, and
// `thinkingLevelMap` maps a Pi thinking level to the provider value to send —
// `null` marks that level unsupported.

export const PI_PROVIDER_KEY = "9router";

export const PI_CONTEXT_WINDOWS = [200000, 400000, 600000, 1000000];
export const PI_MAX_TOKENS = [16000, 32000, 64000, 128000];

// Levels an OpenAI-compatible backend can express through Pi's default
// level -> provider-value mapping. `xhigh` and `max` are supported by Pi only
// when an explicit provider value is mapped for them, which is what
// thinkingLevelMapFromLevels writes from 9Router's per-model level set.
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const PI_ALL_THINKING_LEVELS = PI_THINKING_LEVELS;

// Levels Pi supports for a model with no thinkingLevelMap at all: everything up
// to high, because xhigh and max require an explicit mapping.
export const PI_DEFAULT_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];

// 9Router spells "off" as "none"; every other level shares Pi's name.
export const PI_LEVEL_VALUES = { off: "none" };

/** The provider value 9Router expects for a Pi thinking level. */
export const piLevelValue = (level) => PI_LEVEL_VALUES[level] ?? level;

export const PI_INPUT_VALUES = ["text", "image"];

export const PI_DEFAULT_CAPS = {
  contextWindow: 200000,
  maxTokens: 64000,
  input: ["text"],
  reasoning: false,
  // null means "not known": the card falls back to Pi's own default set and no
  // level map is written, instead of asserting levels the model may not have.
  thinkingLevels: null,
};
export const PI_CAP_LIMITS = { contextWindow: 2000000, maxTokens: 200000 };

export const PI_DEFAULT_CONTEXT_WINDOW = PI_DEFAULT_CAPS.contextWindow;
export const PI_DEFAULT_MAX_TOKENS = PI_DEFAULT_CAPS.maxTokens;
export const PI_MAX_CONTEXT_WINDOW = PI_CAP_LIMITS.contextWindow;
export const PI_MAX_MAX_TOKENS = PI_CAP_LIMITS.maxTokens;

export const formatTokens = (n) =>
  n >= 1000000 ? `${+(n / 1000000).toFixed(2)}M` : `${Math.round(n / 1000)}k`;

export const sanitizeCap = (v, fallback, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
};

export const capOptions = (values, current) =>
  values.includes(current) ? values : [...values, current].sort((a, b) => a - b);

/** Editable capabilities for one model, with Pi's defaults filled in. */
export const piModelCaps = (caps) => ({ ...PI_DEFAULT_CAPS, ...caps });

/**
 * The levels a stored `thinkingLevelMap` leaves supported.
 *
 * Mirrors getSupportedThinkingLevels() in Pi: an omitted level keeps Pi's default
 * support, an explicit `null` removes it, and `xhigh` / `max` count only when a
 * provider value is mapped for them. No map at all means Pi's default set.
 */
export const readThinkingLevels = (map) => {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [...PI_DEFAULT_THINKING_LEVELS];

  return PI_THINKING_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
};

/**
 * 9Router's level set for a model, in Pi's vocabulary.
 *
 * Returns null when the list is missing or holds a level Pi cannot express (zai's
 * binary `thinking`, codex's `ultra`), so an unfamiliar model keeps Pi's defaults
 * rather than being described as worse than it is.
 */
export const levelsFromServer = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const levels = [];
  for (const value of raw) {
    if (typeof value !== "string") return null;
    const level = value === "none" ? "off" : value;
    if (!PI_THINKING_LEVELS.includes(level)) return null;
    levels.push(level);
  }

  return PI_THINKING_LEVELS.filter((level) => levels.includes(level));
};

/** A full thinkingLevelMap for a set of supported Pi levels. */
export const thinkingLevelMapFromLevels = (levels) =>
  Object.fromEntries(
    PI_THINKING_LEVELS.map((level) => [level, levels.includes(level) ? piLevelValue(level) : null])
  );

/**
 * Capabilities a model starts with when it is added to the card.
 *
 * `info` is one entry's `caps` from /api/models ({ vision, reasoning,
 * contextWindow, maxOutput }) plus `thinking_levels`, the set 9Router resolves for
 * the model, so a vision or reasoning model arrives configured instead of
 * defaulting to text-only, 200k, 64k, no thinking.
 */
export const capsFromModelInfo = (info) => ({
  ...PI_DEFAULT_CAPS,
  thinkingLevels: levelsFromServer(info?.thinking_levels),
  contextWindow: sanitizeCap(info?.contextWindow, PI_DEFAULT_CONTEXT_WINDOW, PI_MAX_CONTEXT_WINDOW),
  maxTokens: sanitizeCap(info?.maxOutput, PI_DEFAULT_MAX_TOKENS, PI_MAX_MAX_TOKENS),
  input: info?.vision ? ["text", "image"] : ["text"],
  reasoning: info?.reasoning === true,
});

/** True when the entry enables image input. */
export const piInputHasImage = (caps) => Array.isArray(caps?.input) && caps.input.includes("image");

/**
 * The models.json entry for one model.
 *
 * A level map is written whenever the model's levels are known and it thinks, so
 * `xhigh` / `max` become reachable and unsupported levels are marked null. When
 * thinking is off the entry carries `{}`: an empty map is schema-valid if it ever
 * reaches the file, and the settings route reads it as "drop the stored map". It
 * must never be `null` — Pi's ThinkingLevelMapSchema is an object, so a null map
 * invalidates the whole models.json and Pi then reports every provider in it as
 * unknown.
 */
export const buildPiModelEntry = (id, caps = {}) => {
  const merged = piModelCaps(caps);
  const entry = {
    id,
    name: id,
    contextWindow: merged.contextWindow,
    maxTokens: merged.maxTokens,
    input: piInputHasImage(merged) ? ["text", "image"] : ["text"],
    reasoning: merged.reasoning === true,
  };

  if (merged.reasoning !== true) {
    entry.thinkingLevelMap = {};
  } else if (Array.isArray(merged.thinkingLevels)) {
    entry.thinkingLevelMap = thinkingLevelMapFromLevels(merged.thinkingLevels);
  }

  return entry;
};

/** Read the card's model list and capabilities back out of a Pi models.json. */
export const readPiModels = (cfg) => {
  const list = cfg?.providers?.[PI_PROVIDER_KEY]?.models;
  if (!Array.isArray(list) || list.length === 0) return null;

  const caps = {};
  const ids = list.map((entry) => {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (typeof entry !== "string") {
      caps[id] = {
        contextWindow: sanitizeCap(entry?.contextWindow, PI_DEFAULT_CONTEXT_WINDOW, PI_MAX_CONTEXT_WINDOW),
        maxTokens: sanitizeCap(entry?.maxTokens, PI_DEFAULT_MAX_TOKENS, PI_MAX_MAX_TOKENS),
        input: piInputHasImage(entry) ? ["text", "image"] : ["text"],
        reasoning: entry?.reasoning === true,
        thinkingLevels: readThinkingLevels(entry?.thinkingLevelMap),
      };
    }
    return id;
  });

  return { ids, caps };
};

/** Pi accepts `input` only from PI_INPUT_VALUES; anything else is dropped. */
export const sanitizePiInput = (input) => {
  if (!Array.isArray(input)) return undefined;
  const values = [...new Set(input.filter((value) => PI_INPUT_VALUES.includes(value)))];
  return values.length > 0 ? values : undefined;
};

/**
 * Keep the levels Pi knows about and the two value kinds it accepts: a provider
 * value string, or `null` for "unsupported".
 */
export const sanitizePiThinkingLevelMap = (map) => {
  if (!map || typeof map !== "object" || Array.isArray(map)) return undefined;

  const clean = {};
  for (const level of PI_ALL_THINKING_LEVELS) {
    const value = map[level];
    if (typeof value === "string" || value === null) clean[level] = value;
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
};

/**
 * The capability fields a models.json entry should carry, from a raw merged entry.
 *
 * Anything the schema rejects is left out, so a stale or hand-edited value is
 * dropped the first time the card applies instead of being written back. An empty
 * `thinkingLevelMap: {}` is the card's "clear the map" signal and is dropped here
 * too, which removes a stored map without writing a null Pi would reject.
 */
export const sanitizePiModelCaps = (raw) => {
  const clean = {};

  const input = sanitizePiInput(raw?.input);
  if (input) clean.input = input;

  if (typeof raw?.reasoning === "boolean") clean.reasoning = raw.reasoning;

  const thinkingLevelMap = sanitizePiThinkingLevelMap(raw?.thinkingLevelMap);
  if (thinkingLevelMap) clean.thinkingLevelMap = thinkingLevelMap;

  return clean;
};
