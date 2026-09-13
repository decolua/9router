// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
// Kept for backward compatibility with existing imports.
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl,
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
  sanitizeComboSystemPromptFields, sanitizeComboThinkingUsageFields, MAX_COMBO_SYSTEM_PROMPT_CHARS,
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
  exportDb, importDb,
} from "@/lib/db/index.js";
