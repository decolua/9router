import { getManualQuota, hasManualQuota } from "@/diepxuan/lib/db/repos/manualQuotaRepo.js";
import { isDiepXuanEnabled } from "@/diepxuan/shared/config/flags.js";

export {
  extendUsageApiKeyProviders,
  extendUsageSupportedProviders,
  isDiepXuanUsageEligible,
  isDiepXuanUsageHookSafe,
} from "./providers.js";

export async function getUsageOverride(connection, connectionId) {
  if (!isDiepXuanEnabled()) return null;
  if (!hasManualQuota(connection.provider)) return null;
  return getManualQuota(connection.provider, connectionId, connection);
}

export async function handleUsageOverrideResponse(connection, connectionId) {
  const usageOverride = await getUsageOverride(connection, connectionId);
  if (!usageOverride) return null;
  return Response.json(usageOverride);
}