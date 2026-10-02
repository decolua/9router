/**
 * `9router show [tools…]` — print the 9router settings currently written in
 * each CLI tool's LOCAL config: base URL, (masked) API key and models.
 *
 * Read-only and offline: never contacts a server and never prints a full key.
 */

const { TOOLS, TOOL_IDS, resolveTools } = require("./connectTools");
const { __test__: { maskKey } } = require("./connect");

const HELP = `
Usage: 9router show [tool…] [options]

Show the 9router settings each CLI tool on THIS machine is currently using.
Read-only: reads local config files, contacts no server.

  9router show                 # every supported tool
  9router show claude          # one tool
  9router show claude codex    # several (or: --tools claude,codex)

Tools: ${TOOL_IDS.join(", ")}, all

Options:
  --tools <list>   Comma-separated tools (same as positional names)
  --json           Machine-readable output (API key still masked)
  -h, --help       Show this help
`;

function parseArgs(argv) {
  const opts = { tools: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tools") {
      const v = argv[++i];
      if (v === undefined) throw new Error("Missing value for --tools");
      opts.tools.push(...v.split(","));
    } else if (a === "--json") opts.json = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (!a.startsWith("-")) opts.tools.push(a);
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

// Normalise one tool's show() output into a printable, key-safe record.
async function inspect(tool) {
  const record = { id: tool.id, name: tool.name, files: tool.paths() };
  try {
    const s = await tool.show();
    record.configured = !!(s.baseUrl || s.apiKey || Object.keys(s.models || {}).length);
    record.baseUrl = s.baseUrl || null;
    record.apiKey = s.apiKey ? maskKey(s.apiKey) : null;
    record.models = s.models || {};
    // `active` is only reported by tools where 9router can be present but not selected.
    if (typeof s.active === "boolean") record.active = s.active;
  } catch (err) {
    record.error = err.message;
  }
  return record;
}

function printRecord(r) {
  if (r.error) {
    console.log(`❌ ${r.name}: ${r.error}`);
    return;
  }
  if (!r.configured) {
    console.log(`• ${r.name}: not configured for 9router (${r.files[0]})`);
    return;
  }
  const inactive = r.active === false ? "  \x1b[33m(9router present but not the active provider)\x1b[0m" : "";
  console.log(`✅ ${r.name}${inactive}`);
  console.log(`   File:     ${r.files.join(", ")}`);
  console.log(`   Base URL: ${r.baseUrl || "(none)"}`);
  console.log(`   API key:  ${r.apiKey || "(none)"}`);
  const entries = Object.entries(r.models);
  if (!entries.length) console.log("   Models:   (none set — the tool's own default applies)");
  else {
    const width = Math.max(...entries.map(([k]) => k.length));
    console.log("   Models:");
    for (const [k, v] of entries) console.log(`     ${k.padEnd(width)}  ${v}`);
  }
}

async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const tools = opts.tools.length ? resolveTools(opts.tools) : TOOLS;
  const records = [];
  for (const t of tools) records.push(await inspect(t));

  if (opts.json) console.log(JSON.stringify(records, null, 2));
  else records.forEach((r, i) => { if (i) console.log(""); printRecord(r); });

  return records.some((r) => r.error) ? 1 : 0;
}

module.exports = { run, __test__: { parseArgs, inspect } };
