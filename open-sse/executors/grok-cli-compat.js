const KNOWN_TOP_LEVEL = new Set([
  "model",
  "input",
  "instructions",
  "reasoning",
  "reasoning_effort",
  "include",
  "tools",
  "tool_choice",
  "text",
  "max_output_tokens",
  "temperature",
  "top_p",
  "parallel_tool_calls",
  "stream",
  "store",
]);

const MESSAGE_ROLES = new Set(["system", "user", "assistant"]);
const NATIVE_REASONING_ID = /^rs_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUNCTION_HISTORY_TYPES = new Set(["function_call", "function_call_output"]);
const INTERNAL_HISTORY_FIELDS = new Set(["internal_chat_message_metadata_passthrough"]);
const HOSTED_TOOL_TYPES = new Set(["web_search", "x_search"]);
const TOOL_CHOICE_MODES = new Set(["auto", "none", "required"]);
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh"]);
const MAX_GROK_CLI_TOOLS = 200;
const FREEFORM_TOOL_PARAMETERS = {
  type: "object",
  properties: { input: { type: "string" } },
  required: ["input"],
};

export class GrokCliCompatibilityError extends Error {
  constructor(message, path = null) {
    super(message);
    this.name = "GrokCliCompatibilityError";
    this.status = 400;
    this.path = path;
  }
}

function normalizeMessageContent(content, path) {
  if (typeof content === "string") return content.length ? content : null;
  if (content == null) return null;
  if (!Array.isArray(content)) {
    throw new GrokCliCompatibilityError("Unsupported Grok CLI message content", path);
  }

  const normalized = [];
  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    const partPath = `${path}[${index}]`;
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      throw new GrokCliCompatibilityError("Unsupported Grok CLI message content", partPath);
    }
    if (
      ["input_text", "output_text", "text"].includes(part.type)
    ) {
      if (typeof part.text !== "string") {
        throw new GrokCliCompatibilityError("Grok CLI message text must be a string", partPath);
      }
      if (part.text.length) normalized.push({ type: "input_text", text: part.text });
      continue;
    }
    if (part.type !== "input_image") {
      throw new GrokCliCompatibilityError(
        `Unsupported Grok CLI message content type: ${part.type || "<missing>"}`,
        partPath,
      );
    }

    const image = { type: "input_image" };
    if (typeof part.image_url === "string" && part.image_url) image.image_url = part.image_url;
    if (typeof part.file_id === "string" && part.file_id) image.file_id = part.file_id;
    if (!image.image_url && !image.file_id) {
      throw new GrokCliCompatibilityError("Grok CLI input image requires image_url or file_id", partPath);
    }
    if (["auto", "low", "high"].includes(part.detail)) image.detail = part.detail;
    normalized.push(image);
  }

  return normalized.length ? normalized : null;
}

function normalizeMessage(item, path) {
  const rawRole = typeof item.role === "string" ? item.role.trim().toLowerCase() : "";
  const role = rawRole === "developer" ? "system" : rawRole;
  if (!MESSAGE_ROLES.has(role)) {
    throw new GrokCliCompatibilityError(
      `Unsupported Grok CLI message role: ${rawRole || "<missing>"}`,
      `${path}.role`,
    );
  }

  const content = normalizeMessageContent(item.content, `${path}.content`);
  if (content === null) return null;
  return { type: "message", role, content };
}

function normalizeReasoningParts(parts, type) {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part) || typeof part.text !== "string") {
      return [];
    }
    return [{ type, text: part.text }];
  });
}

function isNativeReasoning(item) {
  if (typeof item.id !== "string" || typeof item.encrypted_content !== "string") return false;
  if (NATIVE_REASONING_ID.test(item.id)) return true;
  return item.id.startsWith("tco_") && item.encrypted_content.startsWith(`${item.id}_`);
}

function normalizeReasoning(item, diagnostics) {
  if (!isNativeReasoning(item)) {
    diagnostics.droppedInputTypes.push("reasoning");
    return null;
  }

  const reasoning = {
    type: "reasoning",
    id: item.id,
    encrypted_content: item.encrypted_content,
    summary: normalizeReasoningParts(item.summary, "summary_text"),
  };
  if (Array.isArray(item.content)) {
    reasoning.content = normalizeReasoningParts(item.content, "reasoning_text");
  }
  return reasoning;
}

function requiredString(value, field, path) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new GrokCliCompatibilityError(`Grok CLI ${field} must be a non-empty string`, path);
  }
  return normalized;
}

function normalizeArguments(value) {
  let text;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value ?? {});
    } catch {
      return "{}";
    }
  }
  try {
    JSON.parse(text);
    return text;
  } catch {
    return "{}";
  }
}

function normalizeFunctionCall(item, path) {
  return {
    type: "function_call",
    call_id: requiredString(item.call_id, "function call_id", path),
    name: requiredString(item.name, "function name", path),
    arguments: normalizeArguments(item.arguments),
  };
}

function isNativeXSearch(item) {
  return typeof item.id === "string"
    && item.id.startsWith("ctc_")
    && typeof item.call_id === "string"
    && item.call_id.startsWith("xs_call-");
}

function stringifyWireValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}

function normalizeCustomCall(item, path) {
  if (isNativeXSearch(item)) {
    return {
      type: "custom_tool_call",
      id: item.id,
      call_id: item.call_id,
      name: item.name,
      input: item.input,
      status: item.status,
    };
  }

  return {
    type: "function_call",
    call_id: requiredString(item.call_id, "custom tool call_id", path),
    name: requiredString(item.name, "custom tool name", path),
    arguments: JSON.stringify({ input: stringifyWireValue(item.input) }),
  };
}

function normalizeToolOutputPart(part) {
  if (!part || typeof part !== "object" || Array.isArray(part)) return null;
  if (["input_text", "output_text", "text"].includes(part.type) && typeof part.text === "string") {
    return { type: "input_text", text: part.text };
  }
  if (part.type !== "input_image") return null;

  const image = { type: "input_image" };
  if (typeof part.image_url === "string" && part.image_url) image.image_url = part.image_url;
  if (typeof part.file_id === "string" && part.file_id) image.file_id = part.file_id;
  if (!image.image_url && !image.file_id) return null;
  if (["auto", "low", "high"].includes(part.detail)) image.detail = part.detail;
  return image;
}

function normalizeToolOutput(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0) {
    const parts = output.map(normalizeToolOutputPart);
    if (parts.every(Boolean)) return parts;
  }
  return stringifyWireValue(output);
}

function normalizeFunctionOutput(item) {
  const callId = typeof item.call_id === "string" ? item.call_id.trim() : "";
  if (!callId) return null;
  return {
    type: "function_call_output",
    call_id: callId,
    output: normalizeToolOutput(item.output),
  };
}

function cloneBackendHistory(item) {
  return Object.fromEntries(
    Object.entries(item)
      .filter(([key]) => !INTERNAL_HISTORY_FIELDS.has(key))
      .map(([key, value]) => [key, structuredClone(value)]),
  );
}

function repairFunctionSegment(segment, diagnostics) {
  const calls = new Map();
  const lastOutput = new Map();
  for (let index = 0; index < segment.length; index += 1) {
    const item = segment[index];
    if (item.type === "function_call" && !calls.has(item.call_id)) {
      calls.set(item.call_id, item);
    } else if (item.type === "function_call_output") {
      lastOutput.set(item.call_id, index);
    }
  }

  const repaired = [];
  for (let index = 0; index < segment.length; index += 1) {
    const item = segment[index];
    if (item.type === "function_call") {
      if (calls.get(item.call_id) !== item) {
        diagnostics.repairedHistory += 1;
        continue;
      }
      repaired.push(item);
      continue;
    }
    if (!calls.has(item.call_id) || lastOutput.get(item.call_id) !== index) {
      diagnostics.repairedHistory += 1;
      continue;
    }
    repaired.push(item);
  }

  for (const [callId, call] of calls) {
    if (lastOutput.has(callId)) continue;
    repaired.push({
      type: "function_call_output",
      call_id: callId,
      output: `Tool execution was cancelled by the user (tool \`${call.name}\` was not executed).`,
    });
    diagnostics.repairedHistory += 1;
  }
  return repaired;
}

function repairFunctionHistory(items, diagnostics) {
  const repaired = [];
  for (let index = 0; index < items.length;) {
    if (!FUNCTION_HISTORY_TYPES.has(items[index].type)) {
      repaired.push(items[index]);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < items.length && FUNCTION_HISTORY_TYPES.has(items[end].type)) end += 1;
    repaired.push(...repairFunctionSegment(items.slice(index, end), diagnostics));
    index = end;
  }
  return repaired;
}

function normalizeInputItem(item, index, diagnostics) {
  const type = item.type || (item.role ? "message" : "");
  const path = `input[${index}]`;
  if (type === "message") return normalizeMessage(item, path);
  if (type === "reasoning") return normalizeReasoning(item, diagnostics);
  if (type === "function_call") return normalizeFunctionCall(item, path);
  if (["function_call_output", "custom_tool_call_output"].includes(type)) {
    return normalizeFunctionOutput(item);
  }
  if (type === "custom_tool_call") return normalizeCustomCall(item, path);
  if (["web_search_call", "code_interpreter_call"].includes(type)) {
    return cloneBackendHistory(item);
  }
  if (type === "item_reference") return null;
  throw new GrokCliCompatibilityError(
    `Unsupported Grok CLI input item type: ${type || "<missing>"}`,
    path,
  );
}

function normalizeInput(input, diagnostics) {
  if (typeof input === "string") {
    return [{ type: "message", role: "user", content: input || "..." }];
  }
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new GrokCliCompatibilityError("Grok CLI input must be a string or array", "input");
  }

  const normalized = input.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new GrokCliCompatibilityError("Grok CLI input item must be an object", `input[${index}]`);
    }
    const normalizedItem = normalizeInputItem(item, index, diagnostics);
    return normalizedItem ? [normalizedItem] : [];
  });
  return repairFunctionHistory(normalized, diagnostics);
}

function sameSystemMessage(item, instructions) {
  if (item?.type !== "message" || item.role !== "system") return false;
  if (typeof item.content === "string") return item.content === instructions;
  return Array.isArray(item.content)
    && item.content.length === 1
    && item.content[0]?.type === "input_text"
    && item.content[0]?.text === instructions;
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeGrokCliEffort(value) {
  const effort = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (effort === "max") return "xhigh";
  return EFFORT_LEVELS.has(effort) ? effort : "high";
}

function normalizeFunctionTool(tool, custom = false) {
  const nested = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
    ? tool.function
    : null;
  const rawName = typeof tool.name === "string" ? tool.name : nested?.name;
  const name = typeof rawName === "string" ? rawName.trim().slice(0, 128) : "";
  if (!name) return null;

  const rawDescription = typeof tool.description === "string"
    ? tool.description
    : nested?.description;
  const rawParameters = tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
    ? tool.parameters
    : nested?.parameters;
  const rawStrict = typeof tool.strict === "boolean" ? tool.strict : nested?.strict;
  const normalized = {
    type: "function",
    name,
  };
  if (typeof rawDescription === "string" && rawDescription) {
    normalized.description = rawDescription;
  }
  normalized.parameters = custom
    ? structuredClone(FREEFORM_TOOL_PARAMETERS)
    : rawParameters && typeof rawParameters === "object" && !Array.isArray(rawParameters)
      ? structuredClone(rawParameters)
      : { type: "object", properties: {} };
  if (!custom && typeof rawStrict === "boolean") normalized.strict = rawStrict;
  return normalized;
}

function normalizeWebSearchTool(tool) {
  const domains = Array.isArray(tool.filters?.allowed_domains)
    ? [...new Set(tool.filters.allowed_domains
      .filter((domain) => typeof domain === "string")
      .map((domain) => domain.trim())
      .filter(Boolean))]
    : [];
  return domains.length
    ? { type: "web_search", filters: { allowed_domains: domains } }
    : { type: "web_search" };
}

function functionToolChoiceName(choice) {
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return "";
  if (!["function", "custom"].includes(choice.type)) return "";
  const rawName = choice.name ?? choice.function?.name;
  return typeof rawName === "string" ? rawName.trim().slice(0, 128) : "";
}

function normalizeTools(source, diagnostics, preferredFunctionName = "") {
  if (!Array.isArray(source)) return [];

  const functions = [];
  const hosted = [];
  const seenHosted = new Set();
  for (const [index, tool] of source.entries()) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      diagnostics.droppedToolTypes.push("<invalid>");
      continue;
    }
    const type = typeof tool.type === "string" ? tool.type : "";
    if (HOSTED_TOOL_TYPES.has(type)) {
      if (seenHosted.has(type)) {
        diagnostics.droppedToolTypes.push(type);
        continue;
      }
      seenHosted.add(type);
      hosted.push(type === "web_search" ? normalizeWebSearchTool(tool) : { type: "x_search" });
      continue;
    }

    const custom = type === "custom";
    const functionLike = type === "function" || custom || (!type && (tool.name || tool.function));
    if (type && !functionLike) {
      throw new GrokCliCompatibilityError(
        `Unsupported Grok CLI tool type: ${type}`,
        `tools[${index}].type`,
      );
    }
    if (!functionLike) {
      diagnostics.droppedToolTypes.push(type || "<missing>");
      continue;
    }
    const normalized = normalizeFunctionTool(tool, custom);
    if (!normalized) {
      diagnostics.droppedToolTypes.push(type || "function");
      continue;
    }
    if (custom) diagnostics.convertedCustomTools += 1;
    functions.push(normalized);
  }

  const hostedNames = new Set(hosted.map((tool) => tool.type));
  const retainedFunctions = functions.filter((tool) => {
    if (!hostedNames.has(tool.name)) return true;
    diagnostics.droppedToolTypes.push(`function:${tool.name}`);
    return false;
  });
  if (retainedFunctions.length + hosted.length <= MAX_GROK_CLI_TOOLS) {
    return [...retainedFunctions, ...hosted];
  }

  const functionLimit = Math.max(0, MAX_GROK_CLI_TOOLS - hosted.length);
  const limitedFunctions = retainedFunctions.slice(0, functionLimit);
  const preferred = retainedFunctions.find((tool) => tool.name === preferredFunctionName);
  if (preferred && !limitedFunctions.includes(preferred) && functionLimit > 0) {
    limitedFunctions[functionLimit - 1] = preferred;
  }
  const kept = new Set(limitedFunctions);
  for (const tool of retainedFunctions) {
    if (!kept.has(tool)) diagnostics.droppedToolTypes.push(`limit:function:${tool.name}`);
  }
  return [...limitedFunctions, ...hosted];
}

function normalizeToolChoice(choice, tools) {
  if (!tools.length) return undefined;
  if (typeof choice === "string") {
    return TOOL_CHOICE_MODES.has(choice) ? choice : undefined;
  }
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return undefined;
  if (!["function", "custom"].includes(choice.type)) return undefined;

  const name = functionToolChoiceName(choice);
  const functionNames = new Set(
    tools.filter((tool) => tool.type === "function").map((tool) => tool.name),
  );
  return name && functionNames.has(name) ? { type: "function", name } : undefined;
}

function normalizeText(text) {
  const format = text?.format;
  if (!format || typeof format !== "object" || Array.isArray(format)) return undefined;
  if (format.type === "text") return { format: { type: "text" } };
  if (format.type !== "json_schema" || format.schema === undefined) return undefined;

  const name = typeof format.name === "string" && format.name.trim()
    ? format.name.trim()
    : "structured_output";
  const normalized = {
    type: "json_schema",
    name,
    schema: structuredClone(format.schema),
    strict: typeof format.strict === "boolean" ? format.strict : true,
  };
  if (typeof format.description === "string" && format.description) {
    normalized.description = format.description;
  }
  return { format: normalized };
}

export function translateGrokCliResponsesRequest(source = {}, options = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new GrokCliCompatibilityError("Grok CLI request body must be an object", "body");
  }

  const diagnostics = {
    droppedTopLevel: Object.keys(source).filter((key) => !KNOWN_TOP_LEVEL.has(key)),
    droppedInputTypes: [],
    droppedToolTypes: [],
    convertedCustomTools: 0,
    repairedHistory: 0,
  };
  const input = normalizeInput(source.input, diagnostics);
  const instructions = typeof source.instructions === "string" && source.instructions.trim()
    ? source.instructions
    : "";
  if (instructions && !sameSystemMessage(input[0], instructions)) {
    input.unshift({ type: "message", role: "system", content: instructions });
  }
  if (input.length === 0) input.push({ type: "message", role: "user", content: "..." });

  const providerBody = {
    model: options.model || source.model,
    input,
  };
  if (Number.isInteger(source.max_output_tokens) && source.max_output_tokens > 0) {
    providerBody.max_output_tokens = source.max_output_tokens;
  }
  if (validNumber(source.temperature)) providerBody.temperature = source.temperature;
  if (validNumber(source.top_p)) providerBody.top_p = source.top_p;
  if (typeof source.parallel_tool_calls === "boolean") {
    providerBody.parallel_tool_calls = source.parallel_tool_calls;
  }
  const tools = normalizeTools(source.tools, diagnostics, functionToolChoiceName(source.tool_choice));
  if (tools.length) providerBody.tools = tools;
  const toolChoice = normalizeToolChoice(source.tool_choice, tools);
  if (toolChoice !== undefined) providerBody.tool_choice = toolChoice;

  providerBody.reasoning = { summary: "concise" };
  if (options.supportsReasoningEffort) {
    providerBody.reasoning.effort = normalizeGrokCliEffort(
      source.reasoning?.effort ?? source.reasoning_effort,
    );
  }
  providerBody.include = ["reasoning.encrypted_content"];

  const text = normalizeText(source.text);
  if (text) providerBody.text = text;
  providerBody.stream = true;
  providerBody.store = false;

  return {
    body: providerBody,
    diagnostics,
  };
}
