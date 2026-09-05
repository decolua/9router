// Provider/connection access gate — NEW file. Sits in front of anywhere that
// would otherwise hand out provider credentials (including the virtual
// "noauth" connection auth.js injects for free providers). Deliberately does
// NOT wrap or import auth.js's getProviderCredentials — it's a pre-check the
// callers (middleware/scopeAuth.js, scopeModelsFilter.js) consult instead, so
// auth.js stays untouched.
import { isProviderAllowed, isModelAllowed } from "./apiKeyScope.js";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";

/**
 * Free / no-auth providers get NO implicit scope bypass: a scoped key must
 * explicitly include the free provider in `providers` to reach it, exactly
 * like any credentialed provider.
 */
export function isProviderAccessAllowed(scope, providerId) {
  return isProviderAllowed(scope, providerId);
}

export function isModelAccessAllowed(scope, providerId, modelId) {
  return isModelAllowed(scope, providerId, modelId);
}

export function isFreeProvider(providerId) {
  return Boolean(FREE_PROVIDERS[providerId]?.noAuth);
}
