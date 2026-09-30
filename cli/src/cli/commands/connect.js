/**
 * `9router connect <server-url>` — point local CLI tools (Claude Code) at a
 * REMOTE 9router server. Nothing runs locally: we log in with the dashboard
 * password, reuse/create an API key for this machine, then write the tool's
 * settings file. Works via `npx 9router connect …` with no global install.
 *
 * The password and API key are never printed (key is masked).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const RESET_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];

// Mirrors CLI_TOOLS.claude.defaultModels in src/shared/constants/cliTools.js.
const CLAUDE_MODELS = [
  { flag: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL", defaultValue: "cc/claude-fable-5" },
  { flag: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL", defaultValue: "cc/claude-opus-5" },
  { flag: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", defaultValue: "cc/claude-sonnet-5" },
  { flag: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL", defaultValue: "cc/claude-haiku-4-5-20251001" },
];

const HELP = `
Usage: 9router connect <server-url> [options]

Configure Claude Code on THIS machine to use a remote 9router server.
No local server is started. Run without installing:

  npx 9router connect http://<server-host>:20128

Options:
  --password <pw>        Dashboard password (or env NINE_ROUTER_PASSWORD;
                         prompted if omitted — preferred, keeps it out of shell history)
  --key-name <name>      API key name to reuse/create (default: cli-<hostname>)
  --api-key <key>        Use this API key, skip login + key lookup
  --fable|--opus|--sonnet|--haiku <model>
                         Override model mapping (e.g. --sonnet cc/claude-sonnet-5)
  --print-env            Also print OpenAI-compatible env vars for other CLIs
  --reset                Remove 9router settings from Claude Code and exit
  -h, --help             Show this help
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

async function promptPassword() {
  if (!process.stdin.isTTY) throw new Error("Password required: pass --password or set NINE_ROUTER_PASSWORD");
  const { Password } = require("enquirer");
  return new Password({ message: "9router dashboard password" }).run();
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

async function listModels(server, apiKey) {
  const res = await request(`${server}/v1/models`, { apiKey });
  if (res.status === 401) throw new Error("API key rejected by server (/v1/models returned 401)");
  if (res.status !== 200) return null;
  return new Set((res.data?.data || []).map((m) => m.id));
}

function claudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/,(\s*[}\]])/g, "$1"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
}

function writeClaudeSettings(env) {
  const file = claudeSettingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = readJson(file);
  // One-time backup of the user's pre-9router settings.
  const backup = `${file}.bak-9router`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const next = { ...current, hasCompletedOnboarding: true, env: { ...(current.env || {}), ...env } };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return file;
}

function resetClaudeSettings() {
  const file = claudeSettingsPath();
  if (!fs.existsSync(file)) return null;
  const current = readJson(file);
  if (current.env) {
    RESET_ENV_KEYS.forEach((k) => delete current.env[k]);
    if (Object.keys(current.env).length === 0) delete current.env;
  }
  fs.writeFileSync(file, JSON.stringify(current, null, 2));
  return file;
}

async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (opts.reset) {
    const file = resetClaudeSettings();
    console.log(file ? `✅ Removed 9router settings from ${file}` : "Nothing to reset");
    return 0;
  }
  if (!opts.url) {
    console.log(HELP);
    return 1;
  }

  const server = normalizeServerUrl(opts.url);
  const isRemoteHttp = server.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(server);
  if (isRemoteHttp) {
    console.log("\x1b[33m⚠ Plain HTTP: password and API key travel unencrypted. Use only on a trusted LAN/VPN.\x1b[0m");
  }

  let apiKey = opts.apiKey;
  if (apiKey) {
    console.log("• Using provided API key");
  } else {
    const password = opts.password ?? (await promptPassword());
    console.log(`• Logging in to ${server}`);
    const cookie = await login(server, password);
    const result = await getOrCreateApiKey(server, cookie, opts.keyName);
    apiKey = result.key;
    console.log(`• ${result.created ? "Created" : "Reusing"} API key "${opts.keyName}" (${maskKey(apiKey)})`);
  }

  const available = await listModels(server, apiKey);
  const env = { ANTHROPIC_BASE_URL: `${server}/v1`, ANTHROPIC_AUTH_TOKEN: apiKey };
  for (const m of CLAUDE_MODELS) {
    const model = opts.models[m.flag] || m.defaultValue;
    env[m.envKey] = model;
    if (available && !available.has(model)) {
      console.log(`\x1b[33m⚠ ${m.flag}: "${model}" not listed by server — override with --${m.flag} <model>\x1b[0m`);
    }
  }

  const file = writeClaudeSettings(env);
  console.log(`✅ Claude Code configured → ${file}`);
  console.log(`   ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`);
  for (const m of CLAUDE_MODELS) console.log(`   ${m.envKey}=${env[m.envKey]}`);
  console.log("   Restart Claude Code to apply. Undo: npx 9router connect --reset");

  if (opts.printEnv) {
    console.log("\nOpenAI-compatible CLIs (codex, opencode, aider, …):");
    console.log(`   OPENAI_BASE_URL=${server}/v1`);
    console.log(`   OPENAI_API_KEY=${apiKey}`);
  }
  return 0;
}

module.exports = { run, __test__: { parseArgs, normalizeServerUrl, extractAuthCookie, maskKey } };
