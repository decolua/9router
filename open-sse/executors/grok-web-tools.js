// Grok Web client-tool bridge (ported from OmniRoute tool-bridge/native-tools).
//
// Grok's web stream exposes four native tool cards (bash / readFile /
// webSearch / browsePage). When the client declares OpenAI `tools`, this
// bridge (1) injects a CLIENT_TOOLS manifest into the prompt so Grok can also
// call arbitrary tools via <tool_call> markup, and (2) maps native cards onto
// the best-matching declared tool by name/description/schema scoring — in both
// cases emitting standard OpenAI tool_calls back to the client.

function extractTextContent(msg) {
  const content = msg?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part?.text ?? "")))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function getLastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (String(messages[i]?.role || "") === "user") return extractTextContent(messages[i]);
  }
  return "";
}

function stableJson(value) {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.keys(v).sort().reduce((acc, key) => { acc[key] = v[key]; return acc; }, {})
    : v));
}

function normalizeLike(value) {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").replace(/["'`]/g, "").toLowerCase();
  }
  return value;
}

function semanticToolKey(name, args) {
  const record = args && typeof args === "object" ? args : {};
  const parts = Object.keys(record).sort().map((key) => `${key}=${normalizeLike(record[key])}`);
  return `${name}(${parts.join(",")})`;
}

function summarizeCompletedToolCall(name, args) {
  const record = args && typeof args === "object" ? args : {};
  const brief = Object.keys(record).sort().map((key) => String(record[key]).slice(0, 60)).join(", ");
  return `${name}(${brief})`;
}

function getExecutedToolState(messages) {
  const keys = new Set();
  const summaries = [];
  for (const msg of messages) {
    if (String(msg?.role || "") !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const call of msg.tool_calls) {
      const fn = call?.function || {};
      let args = {};
      try { args = JSON.parse(fn.arguments || "{}"); } catch { /* keep {} */ }
      keys.add(semanticToolKey(fn.name || "", args));
      summaries.push(summarizeCompletedToolCall(fn.name || "tool", args));
    }
  }
  return { keys, summaries };
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>)]+/);
  return match ? match[0] : undefined;
}

function wantsUrlFetch(text) {
  return /https?:\/\//.test(String(text || ""));
}

function forcedToolChoiceName(toolChoice) {
  if (toolChoice && typeof toolChoice === "object" && typeof toolChoice.function?.name === "string") {
    return toolChoice.function.name;
  }
  return null;
}

function getSchemaProperties(parameters) {
  const props = parameters && typeof parameters === "object" ? parameters.properties : null;
  return props && typeof props === "object" ? props : {};
}

function getSchemaRequired(parameters) {
  const required = parameters && typeof parameters === "object" ? parameters.required : null;
  return Array.isArray(required) ? required : [];
}

function formatToolArgsSummary(parameters) {
  const propNames = Object.keys(getSchemaProperties(parameters));
  const required = getSchemaRequired(parameters);
  const segments = [];
  if (propNames.length) segments.push(`args=${propNames.join(",")}`);
  if (required.length) segments.push(`required=${required.join(",")}`);
  return segments.length ? ` (${segments.join("; ")})` : "";
}

function toolText(tool) {
  return `${tool.name} ${tool.description || ""}`.toLowerCase();
}

function hasAnyProperty(tool, names) {
  const lowerProps = new Set(Object.keys(getSchemaProperties(tool.parameters)).map((k) => k.toLowerCase()));
  return names.some((name) => lowerProps.has(name.toLowerCase()));
}

function isMetaOrInfrastructureTool(tool) {
  return /\b(mcp|mcpproxy|upstream|registry|oauth|cache key|token usage|handoff|context management|memory|memories|lsp|language server|plan file|server management|tool discovery)\b/.test(toolText(tool));
}

function isContextMemoryTool(tool) {
  return /\b(ctx_|memory|memories|conversation history|session notes|project memories|context\.db)\b/.test(toolText(tool));
}

function isTerminalTool(tool) {
  if (isMetaOrInfrastructureTool(tool)) return false;
  const text = toolText(tool);
  const name = tool.name.toLowerCase();
  const explicitName = /\b(bash|shell|terminal|run_command|execute_command|exec|command)\b/.test(name);
  const explicitText = /\b(?:run|execute).{0,24}\b(?:shell|bash|terminal|command)\b|\b(?:shell|bash|terminal)\b/.test(text);
  return explicitName || (hasAnyProperty(tool, ["command", "cmd", "shell"]) && explicitText);
}

function isFileReadTool(tool) {
  const text = toolText(tool);
  return hasAnyProperty(tool, ["filePath", "file_path", "path"])
    && /\b(read|file|filesystem|open)\b/.test(text)
    && !/\b(write|edit|patch|delete|remove|grep|search|bash|shell|command)\b/.test(text);
}

function isUrlFetchTool(tool) {
  const text = toolText(tool);
  const name = tool.name.toLowerCase();
  const explicitName = /\b(webfetch|web.fetch|fetch_url|url_fetch|read_url|browse_page|browsepage)\b/.test(name);
  const explicitUrlText = /\b(?:fetch|browse|read).{0,32}\b(?:url|uri|web page|page content)\b|\b(?:url|uri|web page|page content).{0,32}\b(?:fetch|browse|read)\b/.test(text);
  return explicitName || (!isMetaOrInfrastructureTool(tool) && hasAnyProperty(tool, ["url", "uri"]) && explicitUrlText);
}

function isWebSearchTool(tool) {
  const text = toolText(tool);
  return hasAnyProperty(tool, ["query", "search"])
    && /\b(web|internet|exa|browser|browse|serp)\b/.test(text)
    && !isMetaOrInfrastructureTool(tool)
    && !isContextMemoryTool(tool);
}

export function buildToolRegistry(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const toolChoice = body?.tool_choice ?? "auto";
  const executed = getExecutedToolState(messages);

  if (toolChoice === "none") {
    return { enabled: false, toolsByName: new Map(), lastUserText: getLastUserText(messages), executedToolKeys: executed.keys, completedToolCalls: executed.summaries };
  }
  const functionTools = tools
    .map((tool) => {
      const fn = tool?.function;
      if (tool?.type !== "function" || !fn || typeof fn !== "object") return null;
      const name = typeof fn.name === "string" ? fn.name.trim() : "";
      if (!name) return null;
      return {
        name,
        ...(typeof fn.description === "string" ? { description: fn.description } : {}),
        parameters: fn.parameters || { type: "object", properties: {} },
      };
    })
    .filter(Boolean);
  const forced = forcedToolChoiceName(toolChoice);
  const visible = forced ? functionTools.filter((tool) => tool.name === forced) : functionTools;
  return {
    enabled: visible.length > 0,
    toolsByName: new Map(visible.map((tool) => [tool.name, tool])),
    lastUserText: getLastUserText(messages),
    executedToolKeys: executed.keys,
    completedToolCalls: executed.summaries,
  };
}

function baseToolOrderScore(tool) {
  if (isUrlFetchTool(tool)) return 90;
  if (isWebSearchTool(tool)) return 85;
  if (isFileReadTool(tool)) return 75;
  if (isTerminalTool(tool)) return 70;
  if (/\b(glob|grep|search files?|file search|content search)\b/.test(toolText(tool))) return 60;
  if (/\b(edit|write|patch|modify|apply)\b/.test(toolText(tool))) return 50;
  if (/\b(task|agent|delegate|subagent)\b/.test(toolText(tool))) return 40;
  if (isContextMemoryTool(tool)) return 20;
  if (isMetaOrInfrastructureTool(tool)) return 10;
  return 30;
}

function orderedTools(registry) {
  return [...registry.toolsByName.values()]
    .map((tool, index) => ({ tool, index, score: baseToolOrderScore(tool) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

export function buildClientToolManifest(registry, toolChoice) {
  if (!registry.enabled) return "";
  const lines = [
    'CLIENT_TOOLS: use this caller-runtime tool list as the tool interface for this request. To call one, respond only with <tool_call>{"name":"exact_tool_name","arguments":{...}}</tool_call>. After tool results, answer normally.',
    `tool_choice=${JSON.stringify(toolChoice ?? "auto")}`,
    ...(registry.completedToolCalls.length
      ? [
          "completed_tool_calls:",
          ...registry.completedToolCalls.map((summary) => `- ${summary}`),
          "Do not repeat completed tool calls unless a different result is required; use their tool results to answer.",
        ]
      : []),
    "tools (priority order for this request):",
    ...orderedTools(registry).map(({ tool }, index) =>
      `${index + 1}. name: ${tool.name}${formatToolArgsSummary(tool.parameters)}${tool.description ? `\n   description: ${tool.description}` : ""}`),
  ];
  return lines.join("\n");
}

/** Parse OpenAI messages into Grok's single-message format, tool-aware. */
export function buildGrokMessage(messages, registry, toolChoice) {
  const manifest = buildClientToolManifest(registry, toolChoice);
  const parts = [];
  let lastUserSourceIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (String(messages[i]?.role || "") === "user") { lastUserSourceIdx = i; break; }
  }
  const extracted = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let role = String(msg?.role || "user");
    if (role === "developer") role = "system";
    let content = extractTextContent(msg);
    if (role === "tool") {
      if (i < lastUserSourceIdx) continue;
      const toolName = typeof msg.name === "string" ? msg.name : "unknown_tool";
      content = `CLIENT TOOL RESULT from caller runtime for ${toolName} (${msg.tool_call_id || "unknown_call"}). Use this result to answer; do not call the same tool again:\n${content}`;
    } else if (role === "assistant" && Array.isArray(msg.tool_calls)) {
      if (i < lastUserSourceIdx) continue;
      const calls = msg.tool_calls.map((call) => ({ id: call.id, function: call.function }));
      content = [content, `Previous assistant tool calls: ${JSON.stringify(calls)}`].filter(Boolean).join("\n");
    }
    if (!content.trim()) continue;
    extracted.push({ role, text: content });
  }
  let lastUserIdx = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") { lastUserIdx = i; break; }
  }
  for (let i = 0; i < extracted.length; i++) {
    parts.push(i === lastUserIdx ? extracted[i].text : `${extracted[i].role}: ${extracted[i].text}`);
  }
  if (manifest.trim()) parts.push(manifest.trim());
  return parts.join("\n\n");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function defaultRequiredValue(key, args, intent) {
  const lower = key.toLowerCase();
  const command = firstString(args.command, args.cmd, args.shell, args.input);
  const path = firstString(args.filePath, args.file_path, args.path, args.filename);
  const query = firstString(args.query, args.search, args.input);
  const url = firstString(args.url, args.uri);
  if (lower === "command" || lower === "cmd") return command;
  if (lower === "filepath" || lower === "file_path" || lower === "path") return path;
  if (lower === "query" || lower === "search") return query;
  if (lower === "url" || lower === "uri") return url;
  if (lower === "input") return query || url || command || path;
  if (lower === "description" || lower === "reason") {
    if (command) return `Execute shell command: ${command}`;
    if (path) return `Read file: ${path}`;
    if (url) return `Fetch URL: ${url}`;
    if (query) return `Search: ${query}`;
    return `Grok Web ${intent} tool call`;
  }
  return undefined;
}

function adaptArguments(toolName, args, registry, intent) {
  const tool = registry.toolsByName.get(toolName);
  if (!tool) return args;
  const properties = getSchemaProperties(tool.parameters);
  const required = getSchemaRequired(tool.parameters);
  const out = { ...args };
  if ("filePath" in properties && !hasValue(out.filePath)) out.filePath = firstString(args.filePath, args.file_path, args.path);
  if ("file_path" in properties && !hasValue(out.file_path)) out.file_path = firstString(args.file_path, args.filePath, args.path);
  if ("path" in properties && !hasValue(out.path)) out.path = firstString(args.path, args.filePath, args.file_path);
  if ("query" in properties && !hasValue(out.query)) out.query = firstString(args.query, args.search, args.input);
  if ("url" in properties && !hasValue(out.url)) out.url = firstString(args.url, args.uri);
  if ("uri" in properties && !hasValue(out.uri)) out.uri = firstString(args.uri, args.url);
  if ("input" in properties && !hasValue(out.input)) out.input = firstString(args.input, args.query, args.command);
  for (const key of required) {
    if (hasValue(out[key])) continue;
    const value = defaultRequiredValue(key, out, intent);
    if (value !== undefined) out[key] = value;
  }
  // Drop args the declared schema does not know (keeps the client's validator happy).
  const filtered = {};
  const known = new Set([...Object.keys(properties), ...required]);
  for (const key of Object.keys(out)) {
    if (known.size === 0 || known.has(key)) filtered[key] = out[key];
  }
  return filtered;
}

// ——— Native card mapping (bash / readFile / webSearch / browsePage) ———

function toolScore(tool, intent, lastUserText) {
  const name = tool.name.toLowerCase();
  const description = (tool.description || "").toLowerCase();
  const propNames = new Set(Object.keys(getSchemaProperties(tool.parameters)).map((k) => k.toLowerCase()));
  const text = `${name} ${description}`;
  const userText = String(lastUserText || "").toLowerCase();
  let score = 0;

  if (intent === "bash") {
    if (!isTerminalTool(tool)) score -= 80;
    if (name === "bash") score += 100;
    if (["shell", "terminal", "run_command", "execute_command", "exec", "command"].includes(name)) score += 80;
    if (propNames.has("command") || propNames.has("cmd")) score += 60;
    if (/bash|shell|terminal|command|execute|run/.test(text)) score += 25;
    if (/read|search|grep|web|http|browser|context|note|memory/.test(name)) score -= 50;
  } else if (intent === "readFile") {
    if (!isFileReadTool(tool)) score -= 60;
    if (["read", "read_file", "readfile", "file_read"].includes(name)) score += 100;
    if (propNames.has("filepath") || propNames.has("file_path") || propNames.has("path")) score += 50;
    if (/read.*file|file.*read|filesystem/.test(text)) score += 25;
    if (/write|edit|delete|remove|bash|shell|command/.test(text)) score -= 50;
  } else if (intent === "webSearch" || intent === "browsePage") {
    if (isContextMemoryTool(tool) || isMetaOrInfrastructureTool(tool)) score -= 180;
    if (intent === "browsePage" || wantsUrlFetch(userText)) {
      if (!isUrlFetchTool(tool)) score -= 60;
      if (/webfetch|web_fetch|fetch|browse|browse_page|read_url|url_fetch|page/.test(name)) score += 140;
      if (propNames.has("url") || propNames.has("uri")) score += 90;
      if (/fetch|browse|url|web page|page content|extract.*url|read.*url/.test(text)) score += 55;
      if (/websearch|web_search|search/.test(name) && !(propNames.has("url") || propNames.has("uri"))) score -= 80;
    }
    if (intent === "webSearch" && !isWebSearchTool(tool)) score -= 60;
    if (["web_search", "websearch", "search"].includes(name)) score += 100;
    if (propNames.has("query") || propNames.has("search")) score += 50;
    if (/web.*search|search.*web|internet|browse/.test(text)) score += 25;
    if (/file|bash|shell|command|write|edit/.test(text)) score -= 50;
  }
  return score;
}

function pickDeclaredTool(intent, registry) {
  let best = null;
  for (const tool of registry.toolsByName.values()) {
    const score = toolScore(tool, intent, registry.lastUserText);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { name: tool.name, score };
  }
  return best?.name || null;
}

/**
 * Map a Grok native toolUsageCard onto a declared client tool.
 * Returns an OpenAI tool_call, or null when nothing matches.
 */
export function mapNativeToolCard(card, cardId, registry) {
  if (!registry.enabled || !card || typeof card !== "object") return null;
  const id = cardId || `call_${crypto.randomUUID()}`;

  const tryIntent = (intent, rawArgs) => {
    if (!rawArgs || typeof rawArgs !== "object") return null;
    const name = pickDeclaredTool(intent, registry);
    if (!name) return null;
    const args = adaptArguments(name, rawArgs, registry, intent);
    if (registry.executedToolKeys.has(semanticToolKey(name, args))) return null;
    return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
  };

  const bash = card.bash?.args ? tryIntent("bash", card.bash.args) : null;
  if (bash) return bash;
  const readFile = (card.readFile || card.read_file)?.args ? tryIntent("readFile", (card.readFile || card.read_file).args) : null;
  if (readFile) return readFile;
  const webSearch = card.webSearch?.args ? tryIntent("webSearch", card.webSearch.args) : null;
  if (webSearch) return webSearch;
  const browsePage = (card.browsePage || card.browse_page)?.args ? tryIntent("browsePage", (card.browsePage || card.browse_page).args) : null;
  if (browsePage) return browsePage;
  return null;
}

// ——— Markup fallback for arbitrary tools ———

function* findTagBlocks(text, openRe, closeRe) {
  let searchFrom = 0;
  while (true) {
    const open = openRe.exec(text);
    if (open === null) return;
    const innerStart = open.index + open[0].length;
    const close = closeRe.exec(text.slice(innerStart));
    if (close === null) return;
    yield { inner: text.slice(innerStart, innerStart + close.index), after: innerStart + close.index + close[0].length };
    openRe.lastIndex = closeRe.lastIndex = 0;
    searchFrom = 0;
    text = text.slice(innerStart + close.index + close[0].length);
    if (!text.includes("<tool_call>")) return;
  }
}

function normalizeArbitraryArgs(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return { input: value };
    }
  }
  return {};
}

/** Extract <tool_call>{"name":...,"arguments":...}</tool_call> blocks from Grok's reply. */
export function parseClientToolCallMarkup(text, registry) {
  if (!registry.enabled || !text.includes("<tool_call>")) return null;
  const calls = [];
  for (const block of findTagBlocks(String(text), /<tool_call>/g, /<\/tool_call>/g)) {
    let parsed;
    try { parsed = JSON.parse(block.inner.trim()); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name || !registry.toolsByName.has(name)) continue;
    const args = adaptArguments(name, normalizeArbitraryArgs(parsed.arguments), registry, "clientTool");
    if (registry.executedToolKeys.has(semanticToolKey(name, args))) continue;
    calls.push({
      id: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : `call_${crypto.randomUUID()}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
  }
  return calls.length > 0 ? calls : null;
}

/** True while a <tool_call> block may still be streaming in. */
export function hasOpenToolCallMarkup(text) {
  return /<tool(?:_call)?$|<tool_call[^>]*$/.test(text)
    || (text.includes("<tool_call>") && !text.includes("</tool_call>"));
}

/** Remove the injected manifest from text destined back to the client. */
export function stripClientToolManifest(text) {
  return String(text || "").replace(/CLIENT_TOOLS: [\s\S]*?(?=\n\n|$)/, "").trim();
}
