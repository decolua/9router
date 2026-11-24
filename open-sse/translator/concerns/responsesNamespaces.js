import { createHash } from "node:crypto";
import { OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";

export function createNamespaceToolBridge(tools, inputItems = []) {
  const namespaceToolMap = new Map();
  const namesByIdentity = new Map();
  const reservedNames = new Set(tools.filter(tool => tool?.type !== "namespace")
    .map(tool => tool?.function?.name || tool?.name).filter(Boolean));

  const flattenName = (namespace, name) => {
    if (typeof namespace !== "string" || !namespace || typeof name !== "string" || !name) return name;
    const identity = JSON.stringify([namespace, name]);
    if (namesByIdentity.has(identity)) return namesByIdentity.get(identity);
    const readableName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 28);
    let attempt = 0;
    let flatName;
    do {
      const digest = createHash("sha256").update(`${identity}:${attempt++}`).digest("hex").slice(0, 24);
      flatName = `ns_${readableName}_${digest}`;
    } while (reservedNames.has(flatName));
    reservedNames.add(flatName);
    namesByIdentity.set(identity, flatName);
    namespaceToolMap.set(flatName, { namespace, name });
    return flatName;
  };

  const flattenedTools = tools.flatMap(tool => {
    if (tool?.type !== "namespace") return [tool];
    if (typeof tool.name !== "string" || !tool.name || !Array.isArray(tool.tools)) return [];
    return tool.tools.filter(nested => nested && [OPENAI_BLOCK.FUNCTION, "custom"].includes(nested.type))
      .map(nested => ({
        ...nested,
        name: flattenName(tool.name, nested.name),
        description: [`Namespace: ${tool.name}.`, tool.description, nested.description].filter(Boolean).join("\n\n"),
      }));
  });

  for (const item of inputItems) {
    if ([RESPONSES_ITEM.FUNCTION_CALL, RESPONSES_ITEM.CUSTOM_TOOL_CALL].includes(item?.type)) {
      flattenName(item.namespace, item.name);
    }
  }

  return { flattenedTools, namespaceToolMap, flattenName };
}

export function restoreNamespaceToolCalls(payload, namespaceToolMap) {
  if (!payload || !namespaceToolMap?.size) return payload;
  if (Array.isArray(payload)) return payload.map(item => restoreNamespaceToolCalls(item, namespaceToolMap));
  if (typeof payload !== "object") return payload;
  if ([RESPONSES_ITEM.FUNCTION_CALL, RESPONSES_ITEM.CUSTOM_TOOL_CALL].includes(payload.type)) {
    const identity = namespaceToolMap.get(payload.name);
    return identity ? { ...payload, ...identity } : payload;
  }
  const result = { ...payload };
  for (const key of ["data", "item", "response", "output"]) {
    if (payload[key]) result[key] = restoreNamespaceToolCalls(payload[key], namespaceToolMap);
  }
  return result;
}
