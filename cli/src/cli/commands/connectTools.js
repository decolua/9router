/**
 * Per-tool config writers for `9router connect`. File layout and keys mirror
 * the dashboard routes in src/app/api/cli-tools/<tool>-settings/route.js so a
 * tool configured here looks identical to one applied from the dashboard.
 *
 * Each tool: { id, name, paths(), apply(ctx) → string[] written, reset() → string[] touched }
 * Optional: route + serverModel(data) to inherit the server's model; needsModel: false
 * for tools that discover models themselves (omp).
 * ctx: { baseUrl (origin, no /v1), apiKey, model, claudeModels: { envKey: model } }
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const home = () => os.homedir();
const v1 = (baseUrl) => (baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`);
const isStr = (v) => typeof v === "string" && v.length > 0;

// Drop trailing commas (JSONC) outside string literals, so values like "a,}" survive.
function stripTrailingCommas(text) {
  return text.replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (m, str, tail) => str ?? tail);
}

function readJson(file) {
  try {
    return JSON.parse(stripTrailingCommas(fs.readFileSync(file, "utf8")));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
}

// Files hold the API key → owner-only (0600) on POSIX; no-op on Windows.
const SECRET_MODE = 0o600;

// Rewrite an existing file on reset (no backup, existing mode kept).
function rewriteFile(file, content) {
  fs.writeFileSync(file, content, { mode: SECRET_MODE });
}

// One-time backup of the user's pre-9router file, then write.
function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = `${file}.bak-9router`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, SECRET_MODE);
  }
  fs.writeFileSync(file, content, { mode: SECRET_MODE });
  fs.chmodSync(file, SECRET_MODE); // mode above only applies when creating
}

const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2));

// confbox (TOML/YAML) is ESM-only; loaded lazily so other tools don't need it.
async function toml() {
  return import("confbox");
}

// ── Claude Code ─────────────────────────────────────────────────────────────
const CLAUDE_MODELS = [
  { flag: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  { flag: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { flag: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { flag: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
];
const CLAUDE_RESET_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", ...CLAUDE_MODELS.map((m) => m.envKey)];
const claudePath = () => path.join(home(), ".claude", "settings.json");

const claude = {
  id: "claude",
  name: "Claude Code",
  paths: () => [claudePath()],
  async apply({ baseUrl, apiKey, claudeModels }) {
    const file = claudePath();
    const cur = readJson(file) || {};
    cur.hasCompletedOnboarding = true;
    cur.env = { ...(cur.env || {}), ANTHROPIC_BASE_URL: v1(baseUrl), ANTHROPIC_AUTH_TOKEN: apiKey };
    // A tier with no model (null) is removed so Claude Code uses its own default
    // instead of a stale value from an earlier run.
    for (const m of CLAUDE_MODELS) {
      if (claudeModels[m.envKey]) cur.env[m.envKey] = claudeModels[m.envKey];
      else delete cur.env[m.envKey];
    }
    writeJson(file, cur);
    return [file];
  },
  async show() {
    const env = readJson(claudePath())?.env || {};
    const models = {};
    if (isStr(env.ANTHROPIC_MODEL)) models.main = env.ANTHROPIC_MODEL;
    for (const m of CLAUDE_MODELS) if (isStr(env[m.envKey])) models[m.flag] = env[m.envKey];
    return { baseUrl: env.ANTHROPIC_BASE_URL, apiKey: env.ANTHROPIC_AUTH_TOKEN, models };
  },
  async reset() {
    const file = claudePath();
    const cur = readJson(file);
    if (!cur) return [];
    if (cur.env) {
      CLAUDE_RESET_KEYS.forEach((k) => delete cur.env[k]);
      if (Object.keys(cur.env).length === 0) delete cur.env;
    }
    rewriteFile(file, JSON.stringify(cur, null, 2));
    return [file];
  },
};

// ── OpenAI Codex CLI ────────────────────────────────────────────────────────
const codexPath = () => path.join(home(), ".codex", "config.toml");

const codex = {
  id: "codex",
  name: "OpenAI Codex CLI",
  paths: () => [codexPath()],
  route: "codex-settings",
  // GET returns raw TOML text; only trust `model` when the provider is 9router.
  async serverModel(data) {
    if (!isStr(data?.config)) return null;
    const { parseTOML } = await toml();
    const cfg = parseTOML(data.config) || {};
    return cfg.model_provider === "9router" && isStr(cfg.model) ? cfg.model : null;
  },
  async apply({ baseUrl, apiKey, model }) {
    const { parseTOML, stringifyTOML } = await toml();
    const file = codexPath();
    let cfg = {};
    try { cfg = parseTOML(fs.readFileSync(file, "utf8")) || {}; } catch (err) { if (err.code !== "ENOENT") throw err; }
    cfg.model = model;
    cfg.model_provider = "9router";
    cfg.model_providers = cfg.model_providers || {};
    // Custom providers ignore auth.json — key must travel as a static header.
    cfg.model_providers["9router"] = {
      name: "9Router",
      base_url: v1(baseUrl),
      wire_api: "responses",
      http_headers: { Authorization: `Bearer ${apiKey}` },
    };
    cfg.agents = cfg.agents || {};
    delete cfg.agents.subagent;
    cfg.agents.default_subagent_model = model;
    writeFile(file, stringifyTOML(cfg));
    return [file];
  },
  async show() {
    let cfg;
    try {
      const { parseTOML } = await toml();
      cfg = parseTOML(fs.readFileSync(codexPath(), "utf8")) || {};
    } catch (err) {
      if (err.code === "ENOENT") return {};
      throw new Error(`Cannot parse ${codexPath()}: ${err.message}`);
    }
    const p = cfg.model_providers?.["9router"];
    const auth = p?.http_headers?.Authorization;
    return {
      baseUrl: p?.base_url,
      apiKey: isStr(auth) ? auth.replace(/^Bearer\s+/i, "") : undefined,
      models: {
        ...(isStr(cfg.model) ? { main: cfg.model } : {}),
        ...(isStr(cfg.agents?.default_subagent_model) ? { subagent: cfg.agents.default_subagent_model } : {}),
      },
      // Codex only routes through 9router when this provider is the active one.
      active: cfg.model_provider === "9router",
    };
  },
  async reset() {
    const { parseTOML, stringifyTOML } = await toml();
    const file = codexPath();
    let cfg;
    try { cfg = parseTOML(fs.readFileSync(file, "utf8")) || {}; } catch (err) { if (err.code === "ENOENT") return []; throw err; }
    if (cfg.model_provider === "9router") { delete cfg.model; delete cfg.model_provider; }
    if (cfg.model_providers) delete cfg.model_providers["9router"];
    if (cfg.agents) { delete cfg.agents.default_subagent_model; delete cfg.agents.subagent; }
    for (const k of ["model_providers", "agents"]) {
      if (cfg[k] && Object.keys(cfg[k]).length === 0) delete cfg[k];
    }
    rewriteFile(file, stringifyTOML(cfg));
    return [file];
  },
};

// ── OpenCode ────────────────────────────────────────────────────────────────
const opencodePath = () => path.join(home(), ".config", "opencode", "opencode.json");

const opencode = {
  id: "opencode",
  name: "OpenCode",
  paths: () => [opencodePath()],
  route: "opencode-settings",
  serverModel(data) {
    const m = data?.config?.model;
    return isStr(m) && m.startsWith("9router/") ? m.slice("9router/".length) : null;
  },
  async apply({ baseUrl, apiKey, model }) {
    const file = opencodePath();
    const cfg = readJson(file) || {};
    cfg.provider = cfg.provider || {};
    const p = cfg.provider["9router"] || { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };
    p.options = { ...p.options, baseURL: v1(baseUrl), apiKey };
    p.models = p.models || {};
    p.models[model] = { name: model, modalities: { input: ["text", "image"], output: ["text"] } };
    cfg.provider["9router"] = p;
    cfg.model = `9router/${model}`;
    cfg.agent = cfg.agent || {};
    cfg.agent.explorer = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `9router/${model}`,
    };
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const cfg = readJson(opencodePath()) || {};
    const p = cfg.provider?.["9router"];
    const models = {};
    if (isStr(cfg.model)) models.main = cfg.model;
    if (isStr(cfg.agent?.explorer?.model)) models.explorer = cfg.agent.explorer.model;
    const listed = Object.keys(p?.models || {});
    if (listed.length) models.available = listed.join(", ");
    return { baseUrl: p?.options?.baseURL, apiKey: p?.options?.apiKey, models, active: !!cfg.model?.startsWith("9router/") };
  },
  async reset() {
    const file = opencodePath();
    const cfg = readJson(file);
    if (!cfg) return [];
    if (cfg.provider) delete cfg.provider["9router"];
    if (cfg.model?.startsWith("9router/")) delete cfg.model;
    if (cfg.agent?.explorer?.model?.startsWith("9router/")) {
      delete cfg.agent.explorer;
      if (Object.keys(cfg.agent).length === 0) delete cfg.agent;
    }
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Factory Droid ───────────────────────────────────────────────────────────
const droidPath = () => path.join(home(), ".factory", "settings.json");
const isDroid9r = (m) => m.id?.startsWith("custom:9Router");

const droid = {
  id: "droid",
  name: "Factory Droid",
  paths: () => [droidPath()],
  route: "droid-settings",
  serverModel(data) {
    const m = (data?.settings?.customModels || []).find(isDroid9r)?.model;
    return isStr(m) ? m : null;
  },
  async apply({ baseUrl, apiKey, model }) {
    const file = droidPath();
    const cfg = readJson(file) || {};
    const others = (cfg.customModels || []).filter((m) => !isDroid9r(m));
    cfg.customModels = [
      {
        model,
        id: "custom:9Router-0",
        index: 0,
        baseUrl: v1(baseUrl),
        apiKey,
        displayName: model,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      },
      ...others,
    ];
    cfg.customModels.forEach((m, i) => { m.index = i; });
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const ours = (readJson(droidPath())?.customModels || []).filter(isDroid9r);
    return {
      baseUrl: ours[0]?.baseUrl,
      apiKey: ours[0]?.apiKey,
      models: ours.length ? { main: ours[0].model, ...(ours.length > 1 ? { available: ours.map((m) => m.model).join(", ") } : {}) } : {},
    };
  },
  async reset() {
    const file = droidPath();
    const cfg = readJson(file);
    if (!cfg) return [];
    if (cfg.customModels) {
      cfg.customModels = cfg.customModels.filter((m) => !isDroid9r(m));
      if (cfg.customModels.length === 0) delete cfg.customModels;
    }
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Crush ───────────────────────────────────────────────────────────────────
const crushPath = () => path.join(process.env.XDG_CONFIG_HOME || path.join(home(), ".config"), "crush", "crush.json");

const crush = {
  id: "crush",
  name: "Crush",
  paths: () => [crushPath()],
  route: "crush-settings",
  serverModel(data) {
    const m = data?.config?.providers?.["9router"]?.models?.[0]?.id;
    return isStr(m) ? m : null;
  },
  async apply({ baseUrl, apiKey, model }) {
    const file = crushPath();
    const cfg = readJson(file) || {};
    cfg.providers = cfg.providers || {};
    cfg.providers["9router"] = {
      type: "openai-compat",
      base_url: v1(baseUrl),
      api_key: apiKey,
      models: [{ id: model, name: model, context_window: 128000 }],
    };
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const p = readJson(crushPath())?.providers?.["9router"];
    const ids = (p?.models || []).map((m) => m.id).filter(isStr);
    return { baseUrl: p?.base_url, apiKey: p?.api_key, models: ids.length ? { main: ids[0] } : {} };
  },
  async reset() {
    const file = crushPath();
    const cfg = readJson(file);
    if (!cfg?.providers?.["9router"]) return [];
    delete cfg.providers["9router"];
    if (Object.keys(cfg.providers).length === 0) delete cfg.providers;
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Kilo Code (CLI auth only; VS Code settings left to the dashboard) ───────
const kiloPath = () => path.join(home(), ".local", "share", "kilo", "auth.json");

const kilo = {
  id: "kilo",
  name: "Kilo Code CLI",
  paths: () => [kiloPath()],
  // No route: the dashboard GET exposes only auth key names, not the model,
  // so kilo falls back to the shared model.
  async apply({ baseUrl, apiKey, model }) {
    const file = kiloPath();
    const auth = readJson(file) || {};
    auth["openai-compatible"] = { type: "api-key", apiKey, baseUrl: v1(baseUrl), model };
    writeJson(file, auth);
    return [file];
  },
  async show() {
    const a = readJson(kiloPath())?.["openai-compatible"];
    return { baseUrl: a?.baseUrl, apiKey: a?.apiKey, models: isStr(a?.model) ? { main: a.model } : {} };
  },
  async reset() {
    const file = kiloPath();
    const auth = readJson(file);
    if (!auth) return [];
    delete auth["openai-compatible"];
    delete auth["9router"];
    rewriteFile(file, JSON.stringify(auth, null, 2));
    return [file];
  },
};

// ── Cline CLI ───────────────────────────────────────────────────────────────
const clineDir = () => path.join(home(), ".cline", "data");
const clineState = () => path.join(clineDir(), "globalState.json");
const clineSecrets = () => path.join(clineDir(), "secrets.json");

const cline = {
  id: "cline",
  name: "Cline CLI",
  paths: () => [clineState(), clineSecrets()],
  route: "cline-settings",
  serverModel(data) {
    const st = data?.settings;
    return st?.actModeApiProvider === "openai" && isStr(st.openAiModelId) ? st.openAiModelId : null;
  },
  async apply({ baseUrl, apiKey, model }) {
    const state = readJson(clineState()) || {};
    state.actModeApiProvider = "openai";
    state.planModeApiProvider = "openai";
    state.openAiBaseUrl = baseUrl; // Cline expects base WITHOUT /v1
    state.openAiModelId = model;
    state.planModeOpenAiModelId = model;
    writeJson(clineState(), state);
    const secrets = readJson(clineSecrets()) || {};
    secrets.openAiApiKey = apiKey;
    writeJson(clineSecrets(), secrets);
    return [clineState(), clineSecrets()];
  },
  async show() {
    const st = readJson(clineState()) || {};
    const models = {};
    if (isStr(st.openAiModelId)) models.act = st.openAiModelId;
    if (isStr(st.planModeOpenAiModelId)) models.plan = st.planModeOpenAiModelId;
    return {
      baseUrl: st.openAiBaseUrl,
      apiKey: readJson(clineSecrets())?.openAiApiKey,
      models,
      active: st.actModeApiProvider === "openai",
    };
  },
  async reset() {
    const state = readJson(clineState());
    if (!state) return [];
    if (state.actModeApiProvider === "openai") {
      delete state.openAiBaseUrl;
      delete state.openAiModelId;
      delete state.planModeOpenAiModelId;
      state.actModeApiProvider = "cline";
      state.planModeApiProvider = "cline";
    }
    rewriteFile(clineState(), JSON.stringify(state, null, 2));
    const touched = [clineState()];
    const secrets = readJson(clineSecrets());
    if (secrets) {
      delete secrets.openAiApiKey;
      rewriteFile(clineSecrets(), JSON.stringify(secrets, null, 2));
      touched.push(clineSecrets());
    }
    return touched;
  },
};

// ── Pi (pi-coding-agent) ────────────────────────────────────────────────────
// Prefers ~/.pi/agent/models.json; an existing legacy ~/.pi/models.json is used instead.
const piPath = () => {
  const agent = path.join(home(), ".pi", "agent", "models.json");
  const root = path.join(home(), ".pi", "models.json");
  return !fs.existsSync(agent) && fs.existsSync(root) ? root : agent;
};

const pi = {
  id: "pi",
  name: "Pi",
  paths: () => [piPath()],
  route: "pi-settings",
  serverModel(data) {
    const m = data?.config?.providers?.["9router"]?.models?.[0];
    const id = typeof m === "string" ? m : m?.id;
    return isStr(id) ? id : null;
  },
  async apply({ baseUrl, apiKey, model }) {
    const file = piPath();
    const cfg = readJson(file) || {};
    cfg.providers = cfg.providers || {};
    cfg.providers["9router"] = {
      ...(cfg.providers["9router"] || {}),
      baseUrl: v1(baseUrl),
      apiKey,
      api: "openai-completions",
      models: [{ id: model, name: model, contextWindow: 128000, maxTokens: 16384 }],
    };
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const p = readJson(piPath())?.providers?.["9router"];
    const ids = (p?.models || []).map((m) => (typeof m === "string" ? m : m?.id)).filter(isStr);
    return {
      baseUrl: p?.baseUrl,
      apiKey: p?.apiKey,
      models: ids.length ? { main: ids[0], ...(ids.length > 1 ? { available: ids.join(", ") } : {}) } : {},
    };
  },
  async reset() {
    const file = piPath();
    const cfg = readJson(file);
    if (!cfg?.providers?.["9router"]) return [];
    delete cfg.providers["9router"];
    if (Object.keys(cfg.providers).length === 0) delete cfg.providers;
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Oh My Pi ────────────────────────────────────────────────────────────────
// Proxy discovery lists every server model under /model, so no model is written.
// The dashboard also mirrors the key into agent.db; models.yml is the primary
// source, so that best-effort sqlite write is skipped here.
const ompPath = () => path.join(home(), ".omp", "agent", "models.yml");

async function readYaml(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (err) { if (err.code === "ENOENT") return null; throw err; }
  try {
    const { parseYAML } = await toml();
    return parseYAML(text) || {};
  } catch (err) {
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
}

const omp = {
  id: "omp",
  name: "Oh My Pi",
  paths: () => [ompPath()],
  needsModel: false,
  async apply({ baseUrl, apiKey }) {
    const { stringifyYAML } = await toml();
    const file = ompPath();
    const cfg = (await readYaml(file)) || {};
    cfg.providers = cfg.providers || {};
    cfg.providers["9router"] = {
      baseUrl: v1(baseUrl),
      apiKey,
      api: "openai-completions",
      authHeader: true,
      disableStrictTools: true,
      discovery: { type: "proxy" },
    };
    writeFile(file, stringifyYAML(cfg));
    return [file];
  },
  async show() {
    const p = (await readYaml(ompPath()))?.providers?.["9router"];
    return {
      baseUrl: p?.baseUrl,
      apiKey: p?.apiKey,
      models: p?.discovery?.type === "proxy" ? { main: "(all server models, via discovery)" } : {},
    };
  },
  async reset() {
    const { stringifyYAML } = await toml();
    const file = ompPath();
    const cfg = await readYaml(file);
    if (!cfg?.providers?.["9router"]) return [];
    delete cfg.providers["9router"];
    if (Object.keys(cfg.providers).length === 0) delete cfg.providers;
    rewriteFile(file, Object.keys(cfg).length ? stringifyYAML(cfg) : "");
    return [file];
  },
};

const TOOLS = [claude, codex, opencode, droid, crush, kilo, cline, pi, omp];
const TOOL_IDS = TOOLS.map((t) => t.id);
const TOOL_ALIASES = {
  "claude-code": "claude", "claudecode": "claude", "factory": "droid", "kilocode": "kilo",
  "pi-coding-agent": "pi", "oh-my-pi": "omp",
};

function resolveTools(list) {
  const ids = new Set();
  for (const raw of list) {
    const id = String(raw).trim().toLowerCase();
    if (!id) continue;
    if (id === "all") { TOOL_IDS.forEach((t) => ids.add(t)); continue; }
    const real = TOOL_ALIASES[id] || id;
    if (!TOOL_IDS.includes(real)) throw new Error(`Unknown tool "${raw}". Supported: ${TOOL_IDS.join(", ")}, all`);
    ids.add(real);
  }
  return TOOLS.filter((t) => ids.has(t.id));
}

module.exports = { TOOLS, TOOL_IDS, CLAUDE_MODELS, resolveTools, __test__: { stripTrailingCommas } };
