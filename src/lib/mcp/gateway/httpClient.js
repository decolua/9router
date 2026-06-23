// Shim: re-exports from the TypeScript implementation.
// client.js and other downstream .js files import from this specifier.
// McpAuthError MUST remain in this re-export so client.js keeps working.
export {
  McpAuthError,
  mcpRequest,
  ensureInitialized,
  listTools,
  callTool,
  __test__,
} from "./httpClient.ts";
