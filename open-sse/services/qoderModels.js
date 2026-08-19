/**
 * Qoder model catalog — re-exports protocol catalog (single source of truth).
 */

import { isQoderPat, resolvePatCredential } from "../protocol/qoder/index.js";

export {
  getQoderModelConfig,
  resolveQoderModels,
  invalidateQoderCatalog,
  clearQoderCatalog,
} from "../protocol/qoder/index.js";

/**
 * Resolve a Qoder PAT to credentials usable by catalog and quota requests.
 * Device and job-token credentials pass through unchanged.
 */
export async function resolveQoderCredentials(credentials, proxyOptions = null, signal = null) {
  const rawToken = credentials?.apiKey || credentials?.accessToken;
  if (!isQoderPat(rawToken)) return credentials;

  const profile = credentials?.provider === "qoderwork-cn" ? "cn-work" : "intl";
  const resolved = await resolvePatCredential(rawToken, { profile, proxyOptions, signal });
  const providerSpecificData = credentials?.providerSpecificData || {};

  return {
    ...credentials,
    accessToken: resolved.accessToken,
    apiKey: undefined,
    providerSpecificData: {
      authMethod: "pat",
      ...providerSpecificData,
      userId: resolved.userId || providerSpecificData.userId || "",
      machineId: providerSpecificData.machineId || "",
      machineToken: providerSpecificData.machineToken || "",
    },
  };
}
