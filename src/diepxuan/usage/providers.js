import {
  DIEPXUAN_USAGE_APIKEY_PROVIDERS,
  DIEPXUAN_USAGE_SUPPORTED_PROVIDERS,
} from "@/diepxuan/shared/constants/providers.js";
import { isDiepXuanEnabled, isDiepXuanSafeMode } from "@/diepxuan/shared/config/flags.js";

export function extendUsageSupportedProviders(baseProviders) {
  if (!isDiepXuanEnabled()) return Array.isArray(baseProviders) ? baseProviders : [];
  return [...(Array.isArray(baseProviders) ? baseProviders : []), ...DIEPXUAN_USAGE_SUPPORTED_PROVIDERS];
}

export function extendUsageApiKeyProviders(baseProviders) {
  if (!isDiepXuanEnabled()) return Array.isArray(baseProviders) ? baseProviders : [];
  return [...(Array.isArray(baseProviders) ? baseProviders : []), ...DIEPXUAN_USAGE_APIKEY_PROVIDERS];
}

export function isDiepXuanUsageEligible(connection, baseSupportedProviders, baseApiKeyProviders) {
  if (!isDiepXuanEnabled()) return false;
  const supportedProviders = extendUsageSupportedProviders(baseSupportedProviders);
  const apiKeyProviders = extendUsageApiKeyProviders(baseApiKeyProviders);

  return supportedProviders.includes(connection.provider) && (
    connection.authType === "oauth" || apiKeyProviders.includes(connection.provider)
  );
}

export function isDiepXuanUsageHookSafe() {
  return isDiepXuanEnabled() && !isDiepXuanSafeMode();
}