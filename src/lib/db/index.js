// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
  createOrgSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey, resolveApiKeyUserId, isApiKeyValid,
} from "./repos/apiKeysRepo.js";

// Users
export {
  getUsers, getUserById, getUserByEmail, getUserByOidcSub, getAdminUser, countUsers,
  createUser, verifyUserPassword, updateUser, setUserStatus, createInvite, consumeInvite, deleteUser,
} from "./repos/usersRepo.js";

// Organizations
export {
  getOrganizationById,
  getOrganizationBySlug,
  listOrganizations,
  createOrganization,
  getDefaultOrgId,
  isSlugAvailable,
  DEFAULT_ORG_SLUG,
} from "./repos/organizationsRepo.js";

// Per-user settings
export {
  getUserSettings, updateUserSettings, getEffectiveSettings,
} from "./repos/userSettingsRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData, getOptimizationSavings, getOptimizationSeries,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

// Audit log
export {
  recordAuditEvent, getAuditLogs, AUDIT_RETENTION_DAYS,
} from "./repos/auditLogRepo.js";

// Export/import full DB
export {
  createBackupDownload,
  exportLegacyDbJson as exportDb,
  exportFullDbJson,
  exportPostgresSql,
  getDatabaseInfo,
  importBackup as importDb,
} from "./dbBackup.js";

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
