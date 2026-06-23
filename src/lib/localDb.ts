// Entrypoint → re-export from the canonical DB layer (src/lib/db/)
// Kept for backward compatibility with existing imports.
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
  initDb, statsEmitter, trackPendingRequest, getActiveRequests,
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey,
  validateApiKey, resolveApiKeyRecord,
  getMonthlyUsageForKey, getMonthlyUsageBreakdownForKey,
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
  // MCP gateway
  getInstances, getInstanceById, getInstanceBySlug, getEnabledInstancesByIds,
  createInstance, updateInstance, deleteInstance,
  getGatewayKeys, getGatewayKeyById, createGatewayKey, deleteGatewayKey,
  validateGatewayKey, getGrantsForKey, getGrantsForKeyDetailed, setGrants,
  // Disabled models
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
  // Usage / request details
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
  // Files (OpenAI Files API storage)
  createFile, getFile, listFiles, deleteFile, getFileContent,
  exportDb, importDb,
} from "./db/index.js";
