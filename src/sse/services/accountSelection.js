import { effectiveConnectionId } from "open-sse/utils/modelReference.js";
import { ACCOUNT_FALLBACK_MODES, normalizeAccountFallbackMode } from "open-sse/config/accountRouting.js";
import { getAllowedConnectionIds, getAllowedProviderConnectionIds } from "./keyAccess.js";

/** Shared selection constraints; handlers retain their provider-specific retries. */
export async function accountSelectionOptions(modelInfo, request, {
  keyAccess = null,
  providerOnly = false,
  grantedByCombo = false,
  accountFallbackMode,
  stickyConnectionId = null,
} = {}) {
  const explicitId = effectiveConnectionId(modelInfo, request);
  const strict = explicitId && normalizeAccountFallbackMode(accountFallbackMode) === ACCOUNT_FALLBACK_MODES.STRICT;
  return {
    requiredConnectionId: strict ? explicitId : null,
    preferredConnectionId: strict ? explicitId : (stickyConnectionId || explicitId),
    allowedConnectionIds: grantedByCombo || !keyAccess ? null : await (providerOnly ? getAllowedProviderConnectionIds(keyAccess, modelInfo.provider) : getAllowedConnectionIds(keyAccess, modelInfo.provider, modelInfo.model)),
  };
}
