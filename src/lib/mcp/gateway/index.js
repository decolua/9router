/**
 * MCP gateway handlers.
 *
 * Every JSON-RPC method the gateway exposes to clients is implemented as a
 * dedicated handler that either aggregates across upstream servers, routes to
 * one specific upstream by prefix, or answers with gateway-owned data.
 *
 * Handlers are grouped by MCP capability:
 *  - `tools.js`      tools/list, tools/call
 *  - `prompts.js`    prompts/list, prompts/get
 *  - `resources.js`  resources/list, resources/templates/list, resources/read
 *  - `completion.js` completion/complete
 *  - `aggregator.js` shared fan-out helper + tools/list cache
 */

export { invalidateToolsListCache } from "./aggregator.js";
export { handleToolsList, handleToolsCall } from "./tools.js";
export { handlePromptsList, handlePromptsGet } from "./prompts.js";
export {
  handleResourcesList,
  handleResourceTemplatesList,
  handleResourcesRead,
} from "./resources.js";
export { handleCompletionComplete } from "./completion.js";
