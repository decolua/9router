const KNOWN_CUSTOM_TOOL_NAMES = new Set(["apply_patch"]);

function getToolName(tool) {
  return tool?.name || tool?.function?.name || "";
}

function isFreeformToolDefinition(tool) {
  if (!tool || typeof tool !== "object") return false;
  const type = tool.type || "";
  const name = getToolName(tool);
  return type === "custom" ||
    type === "custom_tool" ||
    tool.format?.type === "grammar" ||
    tool.input_format?.type === "grammar" ||
    KNOWN_CUSTOM_TOOL_NAMES.has(name);
}

export function getResponsesCustomToolNames(body) {
  const names = new Set();
  if (!Array.isArray(body?.tools)) return names;

  for (const tool of body.tools) {
    const name = getToolName(tool);
    if (name && isFreeformToolDefinition(tool)) {
      names.add(name);
    }
  }

  return names;
}

export function isResponsesCustomToolName(name, customToolNames) {
  if (!name) return false;
  return customToolNames?.has?.(name) || KNOWN_CUSTOM_TOOL_NAMES.has(name);
}

export function getResponsesToolItemType(name, customToolNames) {
  return isResponsesCustomToolName(name, customToolNames) ? "custom_tool_call" : "function_call";
}

export function getResponsesToolItemIdPrefix(itemType) {
  return itemType === "custom_tool_call" ? "ctc" : "fc";
}

export function getResponsesToolInputEvent(itemType, done = false) {
  if (itemType === "custom_tool_call") {
    return done ? "response.custom_tool_call_input.done" : "response.custom_tool_call_input.delta";
  }
  return done ? "response.function_call_arguments.done" : "response.function_call_arguments.delta";
}

export function buildResponsesToolItem({ itemType, id, callId, name, value }) {
  if (itemType === "custom_tool_call") {
    return {
      id,
      type: itemType,
      input: value,
      call_id: callId,
      name
    };
  }

  return {
    id,
    type: itemType,
    arguments: value,
    call_id: callId,
    name
  };
}
