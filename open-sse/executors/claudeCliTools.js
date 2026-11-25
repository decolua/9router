/**
 * Showing a caller's tools to Claude Code, and getting the calls back out.
 *
 * Claude Code only proposes a tool it can see, and the CLI has no flag for
 * "here are some tool schemas" — `--tools` selects from its own built-in set.
 * The one surface that takes arbitrary tools is MCP, so the caller's tools are
 * advertised by an MCP server that implements the inventory and refuses to run
 * anything. Execution belongs to the client that asked: 9Router is a gateway,
 * and a proposed call goes back over the wire as `tool_calls` exactly as it
 * would from any other provider.
 *
 * The cost of using MCP is a rename: the CLI calls every MCP tool
 * `mcp__<server>__<tool>`, and flattens a dot in the name to an underscore on
 * the way. Both have to be undone before the call reaches the client, which
 * knows only the name it sent — see toolNameMap.
 */
import { CLAUDE_CLI_MCP_SERVER, CLAUDE_CLI_MCP_TOOL_PREFIX } from "../config/claudeCli.js";

// MCP tool names travel through the CLI's own namespacing and back; keep them
// to the characters that survive that round trip unchanged.
//
// The length budget is what is left after the CLI prepends `mcp__<server>__`:
// a name that fits here but not after namespacing is refused upstream, and an
// inventory the CLI rejects takes the whole request with it rather than that
// one tool.
const MCP_NAME_MAX = Math.max(1, 128 - CLAUDE_CLI_MCP_TOOL_PREFIX.length);
const MCP_NAME_PATTERN = new RegExp(`^[A-Za-z0-9_.-]{1,${MCP_NAME_MAX}}$`);

/**
 * The name the CLI will use for a tool offered under this one.
 *
 * It prepends its namespace and flattens a dot to an underscore — measured on
 * 2.1.281. Both the inventory and the map back are built through here so they
 * cannot disagree about what the CLI is going to call something.
 */
function cliToolName(name) {
  return CLAUDE_CLI_MCP_TOOL_PREFIX + String(name).split(".").join("_");
}

/** The schema an MCP server must advertise, from either request dialect. */
function toolDescriptor(tool) {
  if (!tool || typeof tool !== "object") return null;

  // OpenAI: { type: "function", function: { name, description, parameters } }
  // Claude/bare: { name, description, input_schema }
  const fn = tool.function && typeof tool.function === "object" ? tool.function : tool;
  const name = typeof fn.name === "string" ? fn.name.trim() : "";
  if (!MCP_NAME_PATTERN.test(name)) return null;

  const schema = fn.parameters ?? fn.input_schema ?? tool.input_schema;
  return {
    name,
    description: typeof fn.description === "string" ? fn.description : "",
    // An absent schema still has to be an object schema, or the CLI rejects the
    // server's inventory and the whole request dies with it.
    inputSchema: schema && typeof schema === "object" && !Array.isArray(schema)
      ? schema
      : { type: "object", properties: {} },
  };
}

/**
 * @param {Array<object>} tools request tools, in either dialect
 * @returns {Array<object>} MCP descriptors; empty when there is nothing usable
 */
export function toMcpManifest(tools) {
  if (!Array.isArray(tools)) return [];
  const seen = new Set();
  const manifest = [];
  for (const tool of tools) {
    const descriptor = toolDescriptor(tool);
    if (!descriptor) continue;
    // A duplicate name would make the call ambiguous on the way back — and the
    // collision to check is the CLI's name, not the caller's: "a.b" and "a_b"
    // are two tools here and one tool there, which is the same ambiguity one
    // step further down.
    const key = cliToolName(descriptor.name);
    if (seen.has(key)) continue;
    seen.add(key);
    manifest.push(descriptor);
  }
  return manifest;
}

/**
 * What the CLI will call each of these tools.
 *
 * It namespaces every MCP tool as `mcp__<server>__<tool>` — and rewrites a dot
 * in the name to an underscore on the way. Measured on 2.1.281: a tool offered
 * as `github.create_issue` is advertised and proposed as
 * `mcp__ninerouter__github_create_issue`. Stripping the prefix alone therefore
 * handed the client a call naming a tool it had never declared, which it
 * cannot match to anything and cannot answer.
 *
 * The rewrite is not reversible on its own — an underscore may be the caller's
 * own — so the request keeps the map it was built from.
 *
 * @returns {Map<string,string>} the CLI's name for each tool → the caller's
 */
export function toolNameMap(manifest) {
  const map = new Map();
  for (const tool of Array.isArray(manifest) ? manifest : []) {
    const name = tool?.name;
    if (typeof name !== "string" || !name) continue;
    map.set(cliToolName(name), name);
  }
  return map;
}

/**
 * The name the caller used, recovered from the CLI's namespaced form.
 *
 * The map is consulted first, because the CLI's form is not always reversible.
 * Without one — or for a name that is not in it — the prefix is stripped, and
 * anything without the prefix is passed through untouched: a built-in tool
 * would arrive that way, and renaming it would be a lie.
 */
export function callerToolName(name, names = null) {
  const text = String(name || "");
  const mapped = names?.get?.(text);
  if (mapped) return mapped;
  return text.startsWith(CLAUDE_CLI_MCP_TOOL_PREFIX)
    ? text.slice(CLAUDE_CLI_MCP_TOOL_PREFIX.length)
    : text;
}

/**
 * A JSON value as a JavaScript source literal.
 *
 * JSON is a subset of JavaScript expression syntax on every runtime this can
 * reach — the generated program runs on the server's own Node, not a browser —
 * so stringify is the whole conversion.
 */
function jsLiteral(value) {
  return JSON.stringify(value);
}

/**
 * The same value, but parsed at runtime rather than written as source.
 *
 * An object literal is not quite a faithful carrier: a caller-supplied
 * `__proto__` key in a tool schema becomes a prototype assignment instead of a
 * property, so the key silently disappears from the inventory the model is
 * shown. Nothing escapes and Object.prototype is untouched — the program only
 * re-stringifies what it was given — but the schema the caller sent is not the
 * schema that arrives. Parsing a string has no such special case.
 */
function jsParsedLiteral(value) {
  return `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
}

/**
 * The inert MCP server, as a complete program with its inventory baked in.
 *
 * Generated rather than shipped as a file on purpose. The CLI spawns it by
 * path, and a path to a file sitting next to this module cannot be computed
 * reliably: `import.meta.url` is rewritten by the bundler that builds the
 * dashboard, and Next's standalone output traces imports, not siblings. A
 * program written into the request's own temp directory has no such path to
 * resolve, and carries its manifest with it instead of reading a second file.
 *
 * It answers three methods and nothing else: `initialize`, `tools/list`, and
 * `tools/call` — the last with a refusal, so a model that tries to invoke a
 * tool gets a definite answer instead of a silent hang. In practice it never
 * gets that far: the turn ends on the proposal.
 */
export function inertMcpServerSource(manifest) {
  return `// Generated per request by open-sse/executors/claudeCliTools.js.
// Inventory only: this server advertises the caller's tools and runs none of
// them. 9Router hands every proposed call back to the client that asked.
const MANIFEST = ${jsParsedLiteral(manifest)};

function resultFor(method) {
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: ${jsLiteral(CLAUDE_CLI_MCP_SERVER)}, version: "1" },
    };
  }
  if (method === "tools/list") return { tools: MANIFEST };
  if (method === "tools/call") {
    return {
      isError: true,
      content: [{
        type: "text",
        text: "Denied: these tools are inert here. 9Router returns the call to "
          + "the client that requested it, and only that client executes it.",
      }],
    };
  }
  return {};
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    // A notification carries no id and expects no reply.
    if (row.id === undefined || row.id === null) continue;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: row.id,
      result: resultFor(row.method),
    }) + "\\n");
  }
});
`;
}

/** The `--mcp-config` document that points the CLI at the generated server. */
export function mcpConfigDocument(nodeBin, serverPath) {
  return {
    mcpServers: {
      [CLAUDE_CLI_MCP_SERVER]: {
        command: nodeBin,
        args: [serverPath],
      },
    },
  };
}
