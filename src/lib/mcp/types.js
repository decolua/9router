/**
 * @fileoverview
 * Shared type definitions for the MCP subsystem.
 *
 * These are JSDoc typedefs — they have no runtime effect but give IDEs and
 * TypeScript-in-JS autocomplete + typo detection across every module that
 * imports from `@/lib/mcp`. Import via a triple-slash JSDoc reference:
 *
 *   /** @typedef {import("./types.js").McpServer} McpServer *\/
 */

/**
 * A user-configured MCP server record as persisted in the local database.
 *
 * @typedef {Object} McpServer
 * @property {string}                                id
 * @property {string}                                name
 * @property {"remote-http" | "remote-sse" | "local-stdio"} type
 * @property {string}   [url]              remote transports only
 * @property {string}   [command]          local-stdio only
 * @property {string[]} [args]             local-stdio only
 * @property {Record<string, string>} [env]     local-stdio only
 * @property {Record<string, string>} [headers] remote transports only
 * @property {string}   [description]
 * @property {string[]} [toolNames]        per-server tool allow-list
 * @property {boolean}  isActive
 * @property {string}   [prefix]           persisted unique tool-name prefix
 * @property {number}   [lastConnectedAt]  epoch ms
 * @property {number}   [createdAt]        epoch ms
 * @property {number}   [updatedAt]        epoch ms
 */

/**
 * A preset stdio plugin bundled with 9router (see `LOCAL_STDIO_PLUGINS`).
 *
 * @typedef {Object} McpPlugin
 * @property {string}   name
 * @property {string}   command
 * @property {string[]} [args]
 * @property {string}   [description]
 */

/**
 * A JSON-RPC 2.0 message envelope. `id` is present on requests/responses and
 * omitted on notifications.
 *
 * @typedef {Object} JsonRpcMessage
 * @property {"2.0"}          jsonrpc
 * @property {string|number} [id]
 * @property {string}        [method]
 * @property {object}        [params]
 * @property {any}           [result]
 * @property {{ code: number, message: string, data?: any }} [error]
 */

/**
 * A combo definition used by the gateway to filter/truncate the tool list.
 *
 * @typedef {Object} McpCombo
 * @property {string}   name
 * @property {string}   kind
 * @property {boolean}  isActive
 * @property {string[]} [tools]     allow-listed tool names (prefixed or bare)
 * @property {number}   [maxTools]  hard cap on the returned tool count
 */

// This file exports nothing at runtime — it exists purely for JSDoc consumers.
export {};
