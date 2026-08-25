/**
 * User-configured MCP server manager.
 *
 * Public API for driving MCP servers that users register via the dashboard
 * (as opposed to preset stdio plugins, which live in `../bridge.js`).
 *
 * Responsibilities are split across focused modules:
 *  - `state.js`      shared connection store + stdio cooldowns
 *  - `transports.js` remote HTTP + local stdio wire transport
 *  - `sseStream.js`  per-server SSE stream construction
 *  - `sessions.js`   gateway session tracking + broadcast + status
 */

export { sendToMcpServer } from "./transports.js";
export { createMcpSSEStream } from "./sseStream.js";
export {
  registerGatewaySession,
  unregisterGatewaySession,
  getGatewaySession,
  broadcastGatewayNotification,
  notifyToolsListChanged,
  getServerManagerStatus,
} from "./sessions.js";
