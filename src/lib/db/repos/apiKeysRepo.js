// Shim: re-exports from the TypeScript implementation.
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey,
  validateApiKey, resolveApiKeyRecord,
} from "./apiKeysRepo.ts";
