/**
 * `9router acp` — Agent Client Protocol agent server.
 *
 * Spawned by the editor (Zed, JetBrains, VS Code, …) as a subprocess and
 * spoken to over newline-delimited JSON-RPC on stdio. The agent calls the
 * running 9router gateway for completions, so every request keeps the
 * router's fallback, RTK token saver and quota tracking.
 *
 * stdout carries the protocol only: all diagnostics go to stderr/--log.
 */

const { setLogFile, log, error, redact } = require("../acp/log");
const { resolveCredentials, storeCredentials, configFile, DEFAULT_URL } = require("../acp/auth");
const CONFIG_FILE = configFile();

const HELP = `
Usage: 9router acp [options]

Agent Client Protocol (ACP) server for editors. Normally launched by the
editor itself via agent_servers — run it manually only for setup/debugging.

Options:
  --url <url>          9router gateway base URL (default: ${DEFAULT_URL}
                       or env NINE_ROUTER_URL)
  --api-key <key>      API key (prefer env NINE_ROUTER_API_KEY)
  --model <model>      Default model when the gateway list is unavailable
  --log <file>         Append diagnostics to a file (stdout stays protocol)
  --login              Interactive setup: point the agent at a gateway and
                       store the API key (0600 in ${CONFIG_FILE})
  -h, --help           Show this help

Editor setup (Zed): 9router connect zed   then   agent_servers entry:
  { "type": "custom", "command": "9router", "args": ["acp"] }
`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--url") opts.url = next();
    else if (a === "--api-key") opts.apiKey = next();
    else if (a === "--model") opts.model = next();
    else if (a === "--log") opts.log = next();
    else if (a === "--login") opts.login = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

async function promptLine(message, def = "") {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise((resolve) => rl.question(`${message}${def ? ` [${def}]` : ""}: `, resolve));
    return (answer || def).trim();
  } finally {
    rl.close();
  }
}

async function promptSecret(message) {
  const { Password } = require("enquirer");
  const p = new Password({ message });
  const answer = await p.run();
  return String(answer || "").trim();
}

/** Interactive setup used by `--login` and by the ACP terminal auth method. */
async function loginFlow(argv) {
  const opts = parseArgs(argv);
  const isTty = Boolean(process.stdin.isTTY);
  const current = resolveCredentials(opts);
  // Headless is allowed when nothing has to be asked: URL has a default and the
  // password comes from the environment (NINE_ROUTER_PASSWORD).
  const url = (
    isTty
      ? await promptLine("9router gateway URL", opts.url || current.baseUrl || DEFAULT_URL)
      : opts.url || current.baseUrl || DEFAULT_URL
  ).replace(/\/+$/, "");
  process.stderr.write(`Logging in to ${url}…\n`);
  const password =
    opts.password || process.env.NINE_ROUTER_PASSWORD || (isTty ? await promptSecret("Dashboard password") : null);
  if (!password) {
    throw new Error(
      "Interactive login needs a terminal. Set NINE_ROUTER_PASSWORD (or NINE_ROUTER_API_KEY), or run `9router acp --login` in a shell."
    );
  }

  const { login, getOrCreateApiKey } = require("../commands/connect");
  const cookie = await login(url, password);
  const keyName = `acp-${require("os").hostname()}`.slice(0, 64);
  const { key, created } = await getOrCreateApiKey(url, cookie, keyName);
  storeCredentials({ baseUrl: url, apiKey: key });

  // Verify the key against the LLM API before declaring success.
  const { GatewayClient } = require("../acp/gateway/client");
  const gw = new GatewayClient({ baseUrl: url, apiKey: key });
  const models = await gw.models({ fresh: true });
  const masked = key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "****";
  process.stderr.write(
    `✅ Stored ${created ? "new" : "existing"} key "${keyName}" (${masked}) in ${CONFIG_FILE} [0600]\n` +
      `   ${models.length} models available. Restart the editor's agent to pick it up.\n`
  );
  return 0;
}

async function serve(opts) {
  if (opts.log) setLogFile(opts.log);

  // ESM-only SDK loaded from CJS — same dynamic-import pattern as `confbox`
  // in connectTools.js.
  const acp = await import("@agentclientprotocol/sdk");
  const { Readable, Writable } = require("stream");
  const { createAgentApp } = require("../acp/agent");
  const { GatewayClient } = require("../acp/gateway/client");
  const pkg = require("../../../package.json");

  const creds = resolveCredentials(opts);
  if (!creds.apiKey) {
    error(
      `No 9Router API key found. Run \`9router acp --login\`, set NINE_ROUTER_API_KEY, ` +
        `or start the editor from a shell that has it. (gateway: ${redact(creds.baseUrl)})`
    );
    // Not fatal: the client may still call `authenticate` / terminal login.
  }

  const gateway = new GatewayClient({ baseUrl: creds.baseUrl, apiKey: creds.apiKey, log });
  const agent = createAgentApp(acp, {
    opts: { ...opts, ...creds },
    version: pkg.version,
    gatewayFactory: () => gateway,
  });

  const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
  const connection = agent.connect(stream);
  log(`ACP agent listening (gateway ${redact(creds.baseUrl)}, ${creds.apiKey ? "key present" : "no key yet"})`);

  const shutdown = () => {
    try {
      agent.shutdown();
    } catch {
      /* ignore */
    }
  };
  process.on("SIGINT", () => {
    shutdown();
    connection.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    connection.close();
    process.exit(0);
  });

  await connection.closed;
  shutdown();
  log("connection closed");
  return 0;
}

async function run(argv) {
  let opts = null;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      console.log(HELP);
      return 0;
    }
    if (opts.login) return await loginFlow(argv.filter((a) => a !== "--login"));
    return await serve(opts);
  } catch (err) {
    // Full stack only into --log; the editor shows `message` verbatim.
    if (opts?.log) log(err?.stack || String(err));
    console.error(`❌ ${redact(err?.message || String(err))}`);
    return 1;
  }
}

module.exports = { run, __test__: { parseArgs, HELP } };
