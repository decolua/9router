/**
 * `9router connect <server-url>` — point local CLI tools (Claude Code, Codex, …) at a
 * REMOTE 9router server. Nothing runs locally: we log in with the dashboard
 * password, reuse/create an API key for this machine, then write the tool's
 * settings files (see connectTools.js). Works via `npx 9router connect …` with no global install.
 *
 * The password and API key are never printed (key is masked).
 */

const os = require("os");
const { TOOL_IDS, CLAUDE_MODELS, resolveTools } = require("./connectTools");

const DEFAULT_MODEL = "cc/claude-sonnet-5";

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
  --key-name <name>      API key name to reuse/create (default: cli-<hostname>)
  --api-key <key>        Use this API key, skip login + key lookup
  --model <model>        Model for non-Claude tools (default: ${DEFAULT_MODEL})
  --fable|--opus|--sonnet|--haiku <model>
                         Override Claude Code model mapping
  --print-env            Also print OpenAI-compatible env vars for other CLIs
  --reset                Remove 9router settings from the selected tools and exit
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
    else if (a === "--tools") opts.tools = next().split(",");
    else if (a === "--model") opts.model = next();
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
  const warnMissing = (label, model, flag) => {
    if (available && !available.has(model)) {
      console.log(`\x1b[33m⚠ ${label}: "${model}" not listed by server — override with ${flag} <model>\x1b[0m`);
    }
  };

  const claudeModels = {};
  if (tools.some((t) => t.id === "claude")) {
    for (const m of CLAUDE_MODELS) {
      claudeModels[m.envKey] = opts.models[m.flag] || m.defaultValue;
      warnMissing(`claude ${m.flag}`, claudeModels[m.envKey], `--${m.flag}`);
    }
  }
  const model = opts.model || DEFAULT_MODEL;
  if (tools.some((t) => t.id !== "claude")) warnMissing("model", model, "--model");

  const ctx = { baseUrl: server, apiKey, model, claudeModels };
  let failed = 0;
  for (const t of tools) {
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
    for (const m of CLAUDE_MODELS) console.log(`   ${m.envKey}=${claudeModels[m.envKey]}`);
  }
  if (tools.some((t) => t.id !== "claude")) console.log(`   Model (other tools): ${model}`);
  console.log(`   Restart the tools to apply. Undo: npx 9router connect --reset --tools ${tools.map((t) => t.id).join(",")}`);

  if (opts.printEnv) {
    console.log("\nOpenAI-compatible CLIs (codex, opencode, aider, …):");
    console.log(`   OPENAI_BASE_URL=${server}/v1`);
    console.log(`   OPENAI_API_KEY=${apiKey}`);
  }
  return failed ? 1 : 0;
}

module.exports = { run, __test__: { parseArgs, normalizeServerUrl, extractAuthCookie, maskKey, Cancelled } };
