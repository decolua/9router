/**
 * `9router connect <server-url>` — point local CLI tools (Claude Code, Codex, …) at a
 * REMOTE 9router server. Nothing runs locally: we log in with the dashboard
 * password, reuse/create an API key for this machine, then write the tool's
 * settings files (see connectTools.js). Works via `npx 9router connect …` with no global install.
 *
 * The password and API key are never printed (key is masked).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { TOOL_IDS, CLAUDE_MODELS, resolveTools } = require("./connectTools");

const HELP = `
Usage: 9router connect <server-url> [options]

Configure CLI tools on THIS machine to use a remote 9router server.
No local server is started. Run without installing:

  npx 9router connect http://<server-host>:20128
  npx 9router connect http://<server-host>:20128 --tools claude,codex,opencode

Options:
  --tools <list>         Comma-separated tools to configure (prompted if omitted
                         in a terminal; default: claude). Supported:
                         ${TOOL_IDS.join(", ")}, all
  --password <pw>        Dashboard password (or env NINE_ROUTER_PASSWORD;
                         prompted if omitted — preferred, keeps it out of shell history)
  --save                 After a successful login, save the password for this server
                         to ~/.9router/connect.env (plain text, mode 600) so later
                         runs skip the prompt. Delete that file to forget it.
  --key-name <name>      API key name to reuse/create (default: cli-<hostname>)
  --api-key <key>        Use this API key, skip login + key lookup
  --model <model>        Model for all non-Claude tools (default: each tool's own
                         model on the server, else the server's OpenCode model;
                         omp needs none — it discovers every server model)
  --fable|--opus|--sonnet|--haiku <model>
                         Override a Claude Code tier (default: the server's value)
  --print-env            Also print OpenAI-compatible env vars for other CLIs
  --reset                Remove 9router settings from the selected tools and exit
  -h, --help             Show this help

Models come from the server's own CLI-tools config (set on its dashboard).
Nothing is hardcoded: a Claude tier the server leaves unset is left unset,
and a non-Claude tool with no model anywhere is skipped. Flags override:

  npx 9router connect http://<server-host>:20128 --tools claude --sonnet cc/claude-sonnet-5-5
  npx 9router connect http://<server-host>:20128 --tools codex,opencode --model ocg/deepseek-flash
`;

function parseArgs(argv) {
  const opts = {
    password: process.env.NINE_ROUTER_PASSWORD || null,
    keyName: `cli-${os.hostname()}`.slice(0, 64),
    apiKey: null,
    models: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--password") opts.password = next();
    else if (a === "--key-name") opts.keyName = next();
    else if (a === "--api-key") opts.apiKey = next();
    else if (a === "--tools") opts.tools = next().split(",");
    else if (a === "--model") opts.model = next();
    else if (a === "--save") opts.save = true;
    else if (a === "--print-env") opts.printEnv = true;
    else if (a === "--reset") opts.reset = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a.startsWith("--") && CLAUDE_MODELS.some((m) => `--${m.flag}` === a)) opts.models[a.slice(2)] = next();
    else if (!a.startsWith("-") && !opts.url) opts.url = a;
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

function normalizeServerUrl(input) {
  let raw = String(input || "").trim();
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const u = new URL(raw);
  // Accept pasted dashboard/API URLs: keep only origin.
  return u.origin;
}

function maskKey(key) {
  if (!key || key.length < 12) return "****";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

// Saved login (`--save`): dotenv file in the CLI data dir, bound to one server so a
// password is never sent to a different host.
function savedEnvPath() {
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, "connect.env");
  const base = process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
    : path.join(os.homedir(), ".9router");
  return path.join(base, "connect.env");
}

function loadSavedPassword(server) {
  let text;
  try { text = fs.readFileSync(savedEnvPath(), "utf8"); } catch { return null; }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!m) continue;
    // Values are written JSON-quoted; accept a hand-edited bare value too
    // rather than crashing the whole command on JSON.parse.
    try { env[m[1]] = JSON.parse(m[2]); } catch { env[m[1]] = m[2]; }
  }
  return env.NINE_ROUTER_SERVER === server && env.NINE_ROUTER_PASSWORD ? env.NINE_ROUTER_PASSWORD : null;
}

function savePassword(server, password) {
  const file = savedEnvPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = `NINE_ROUTER_SERVER=${JSON.stringify(server)}\nNINE_ROUTER_PASSWORD=${JSON.stringify(password)}\n`;
  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600); // mode only applies on create; tighten a pre-existing file too
  return file;
}

// Enquirer rejects with an empty value on Ctrl+C / Esc.
class Cancelled extends Error {}
const prompt = (p) => p.run().catch((err) => { throw err || new Cancelled("Cancelled"); });

async function promptPassword() {
  if (!process.stdin.isTTY) throw new Error("Password required: pass --password or set NINE_ROUTER_PASSWORD");
  const { Password } = require("enquirer");
  return prompt(new Password({ message: "9router dashboard password" }));
}

async function request(url, { method = "GET", body, cookie, apiKey } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  } catch (err) {
    throw new Error(`Cannot reach ${new URL(url).origin}: ${err.cause?.code || err.message}`);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  // Server-controlled strings get printed later — strip control chars (terminal escape injection).
  if (typeof data?.error === "string") data.error = data.error.replace(/[\x00-\x1f\x7f]/g, "");
  return { status: res.status, headers: res.headers, data };
}

function extractAuthCookie(headers) {
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  for (const c of list) {
    const m = /(?:^|,\s*)auth_token=([^;]+)/.exec(c);
    if (m) return `auth_token=${m[1]}`;
  }
  return null;
}

async function login(server, password) {
  const res = await request(`${server}/api/auth/login`, { method: "POST", body: { password } });
  if (res.status === 200 && res.data?.success) {
    const cookie = extractAuthCookie(res.headers);
    if (!cookie) throw new Error("Login succeeded but server returned no session cookie");
    return cookie;
  }
  throw new Error(`Login failed (${res.status}): ${res.data?.error || "unknown error"}`);
}

async function getOrCreateApiKey(server, cookie, keyName) {
  const list = await request(`${server}/api/keys`, { cookie });
  if (list.status === 401) throw new Error("Unauthorized listing API keys — wrong password or session rejected");
  if (list.status !== 200) throw new Error(`Failed to list API keys (${list.status}): ${list.data?.error || ""}`);
  const keys = (list.data?.keys || []).filter((k) => k.isActive !== false);
  const existing = keys.find((k) => k.name === keyName);
  if (existing) return { key: existing.key, created: false };

  const created = await request(`${server}/api/keys`, { method: "POST", cookie, body: { name: keyName } });
  if (created.status !== 201 || !created.data?.key) {
    throw new Error(`Failed to create API key (${created.status}): ${created.data?.error || ""}`);
  }
  return { key: created.data.key, created: true };
}

// Non-Claude tools that take a single model id (omp discovers all models itself).
const needsModel = (t) => t.id !== "claude" && t.needsModel !== false;

/**
 * Model choices the server operator already made, read from the server's own
 * cli-tools config. Only model ids are taken — never the server's baseUrl or
 * apiKey, which belong to that host and must not be copied to this machine.
 * Best-effort: any failure returns {} and the built-in defaults apply.
 */
async function fetchServerModels(server, cookie, tools) {
  const out = { claude: {}, byTool: {}, shared: null };
  if (!cookie) return out;

  const get = async (route) => {
    try {
      const res = await request(`${server}/api/cli-tools/${route}`, { cookie });
      return res.status === 200 ? res.data : null;
    } catch {
      return null; // unreachable/unreadable — caller keeps defaults
    }
  };

  if (tools.some((t) => t.id === "claude")) {
    const env = (await get("claude-settings"))?.settings?.env;
    for (const m of CLAUDE_MODELS) {
      if (typeof env?.[m.envKey] === "string" && env[m.envKey]) out.claude[m.flag] = env[m.envKey];
    }
  }

  // Each tool's own server config; OpenCode doubles as the shared fallback, so
  // fetch it even when opencode itself wasn't selected.
  const { TOOLS } = require("./connectTools");
  const opencodeTool = TOOLS.find((t) => t.id === "opencode");
  const wanted = tools.filter((t) => t.route);
  if (!wanted.includes(opencodeTool) && tools.some(needsModel)) wanted.push(opencodeTool);

  await Promise.all(wanted.map(async (t) => {
    const data = await get(t.route);
    if (!data) return;
    try {
      const model = await t.serverModel(data);
      if (model) out.byTool[t.id] = model;
    } catch { /* malformed config on the server — skip this tool */ }
  }));
  out.shared = out.byTool.opencode || null;
  return out;
}

async function listModels(server, apiKey) {
  const res = await request(`${server}/v1/models`, { apiKey });
  if (res.status === 401) throw new Error("API key rejected by server (/v1/models returned 401)");
  if (res.status !== 200) return null;
  return new Set((res.data?.data || []).map((m) => m.id));
}

async function promptTools() {
  const { MultiSelect } = require("enquirer");
  const { TOOLS } = require("./connectTools");
  return prompt(new MultiSelect({
    message: "Select CLI tools to configure (space to toggle, enter to confirm)",
    choices: TOOLS.map((t) => ({ name: t.id, message: t.name, hint: t.paths()[0], enabled: t.id === "claude" })),
    validate: (v) => v.length > 0 || "Select at least one tool",
  }));
}

async function selectTools(opts) {
  if (opts.tools) return resolveTools(opts.tools);
  if (process.stdin.isTTY) return resolveTools(await promptTools());
  return resolveTools(["claude"]);
}

async function run(argv) {
  try {
    return await runConnect(argv);
  } catch (err) {
    if (err instanceof Cancelled) {
      console.log("Cancelled.");
      return 130;
    }
    throw err;
  }
}

async function runConnect(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (!opts.reset && !opts.url) {
    console.log(HELP);
    return 1;
  }

  // Pick tools before any network call: bad names fail fast, and cancelling
  // the picker never leaves a freshly created key on the server.
  const tools = await selectTools(opts);

  if (opts.reset) {
    let failed = 0;
    for (const t of tools) {
      try {
        const files = await t.reset();
        console.log(files.length ? `✅ ${t.name}: removed 9router settings (${files.join(", ")})` : `• ${t.name}: nothing to reset`);
      } catch (err) {
        failed++;
        console.log(`❌ ${t.name}: ${err.message}`);
      }
    }
    return failed ? 1 : 0;
  }

  const server = normalizeServerUrl(opts.url);
  const isRemoteHttp = server.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(server);
  if (isRemoteHttp) {
    console.log("\x1b[33m⚠ Plain HTTP: password and API key travel unencrypted. Use only on a trusted LAN/VPN.\x1b[0m");
  }

  let apiKey = opts.apiKey;
  let cookie = null;
  if (apiKey) {
    console.log("• Using provided API key");
  } else {
    const saved = opts.password ? null : loadSavedPassword(server);
    if (saved) console.log(`• Using saved password (${savedEnvPath()})`);
    const password = opts.password ?? saved ?? (await promptPassword());
    console.log(`• Logging in to ${server}`);
    try {
      cookie = await login(server, password);
    } catch (err) {
      if (saved) err.message += ` — saved password may be stale; delete ${savedEnvPath()} or pass --password`;
      throw err;
    }
    if (opts.save && password !== saved) {
      console.log(`• Saved password to ${savePassword(server, password)} (plain text, mode 600)`);
    }
    const result = await getOrCreateApiKey(server, cookie, opts.keyName);
    apiKey = result.key;
    console.log(`• ${result.created ? "Created" : "Reusing"} API key "${opts.keyName}" (${maskKey(apiKey)})`);
  }

  // Models always come from the server's own cli-tools config; flags override.
  const serverModels = await fetchServerModels(server, cookie, tools);
  if (!cookie) {
    console.log("• --api-key given: can't read the server's models (needs a dashboard login) — pass model flags");
  }

  const available = await listModels(server, apiKey);
  const warnMissing = (label, model, flag) => {
    // Claude Code's "[1m]" context marker is part of the env value, not the model id.
    if (available && !available.has(model.replace(/\[1m\]$/, ""))) {
      console.log(`\x1b[33m⚠ ${label}: "${model}" not listed by server — override with ${flag} <model>\x1b[0m`);
    }
  };

  // Claude tier: flag > server value > unset (Claude Code then uses its own default).
  const claudeModels = {};
  const claudeUnset = [];
  if (tools.some((t) => t.id === "claude")) {
    for (const m of CLAUDE_MODELS) {
      const model = opts.models[m.flag] || serverModels.claude[m.flag] || null;
      claudeModels[m.envKey] = model;
      if (model) warnMissing(`claude ${m.flag}`, model, `--${m.flag}`);
      else claudeUnset.push(m.flag);
    }
  }
  // Other tools: --model > that tool's own server model > server's OpenCode model.
  // No hardcoded fallback — a tool with no model anywhere is skipped.
  const toolModels = {};
  const fromOpencode = [];
  for (const t of tools) {
    if (!needsModel(t)) continue;
    toolModels[t.id] = opts.model || serverModels.byTool[t.id] || serverModels.shared || null;
    if (!opts.model && !serverModels.byTool[t.id] && serverModels.shared) fromOpencode.push(t.id);
  }
  for (const m of new Set(Object.values(toolModels).filter(Boolean))) warnMissing("model", m, "--model");
  if (fromOpencode.length) {
    console.log(`• ${fromOpencode.join(", ")}: no own model on the server — using its OpenCode model`);
  }

  let failed = 0;
  let skipped = 0;
  for (const t of tools) {
    if (needsModel(t) && !toolModels[t.id]) {
      skipped++;
      console.log(`⏭  ${t.name}: no model configured on the server — skipped (pass --model <model>)`);
      continue;
    }
    const ctx = { baseUrl: server, apiKey, model: toolModels[t.id], claudeModels };
    try {
      const files = await t.apply(ctx);
      console.log(`✅ ${t.name} → ${files.join(", ")}`);
    } catch (err) {
      failed++;
      console.log(`❌ ${t.name}: ${err.message}`);
    }
  }
  console.log(`   Base URL: ${server}/v1`);
  if (tools.some((t) => t.id === "claude")) {
    for (const m of CLAUDE_MODELS) {
      if (claudeModels[m.envKey]) console.log(`   ${m.envKey}=${claudeModels[m.envKey]}`);
    }
    if (claudeUnset.length) {
      console.log(`   Claude ${claudeUnset.join(", ")}: not set on the server — Claude Code's own default applies (or pass --${claudeUnset[0]} <model>)`);
    }
  }
  for (const [id, m] of Object.entries(toolModels)) if (m) console.log(`   ${id} model: ${m}`);
  if (tools.some((t) => t.id === "omp")) console.log("   omp models: every server model, listed under 9router in /model");
  console.log(`   Restart the tools to apply. Undo: npx 9router connect --reset --tools ${tools.map((t) => t.id).join(",")}`);

  if (opts.printEnv) {
    console.log("\nOpenAI-compatible CLIs (codex, opencode, aider, …):");
    console.log(`   OPENAI_BASE_URL=${server}/v1`);
    console.log(`   OPENAI_API_KEY=${apiKey}`);
  }
  // A skipped tool was not configured, so the run did not do what was asked.
  return failed || skipped ? 1 : 0;
}

module.exports = { run, __test__: { parseArgs, normalizeServerUrl, extractAuthCookie, maskKey, Cancelled, loadSavedPassword, savedEnvPath } };
