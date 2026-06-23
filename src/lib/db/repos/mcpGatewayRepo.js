// Shim: re-exports from the TypeScript implementation.
export {
  getGatewayKeys, getGatewayKeyById, createGatewayKey, deleteGatewayKey,
  validateGatewayKey, getGrantsForKey, getGrantsForKeyDetailed, setGrants,
} from "./mcpGatewayRepo.ts";
