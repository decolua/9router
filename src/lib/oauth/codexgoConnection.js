import { getCodexGoRefreshMeta } from "@/lib/oauth/services/codexGoRefreshPolicy";

export function codexGoSafeConnection(connection) {
  const providerSpecificData = connection?.providerSpecificData || {};
  return {
    id: connection?.id,
    provider: connection?.provider,
    authType: connection?.authType,
    name: connection?.name || null,
    email: connection?.email || null,
    workspace: providerSpecificData.chatgptAccountId || null,
    plan: providerSpecificData.chatgptPlanType || null,
    authMethod: providerSpecificData.authMethod || null,
    codexGoRefresh: getCodexGoRefreshMeta(providerSpecificData),
  };
}

export function buildCodexGoCredentialUpdate(currentConnection, syncedCredentials) {
  const update = {
    refreshToken: currentConnection.refreshToken,
    testStatus: "active",
    lastError: null,
    lastErrorAt: null,
    errorCode: null,
    providerSpecificData: {
      ...(currentConnection.providerSpecificData || {}),
      ...(syncedCredentials.providerSpecificData || {}),
    },
  };

  for (const field of ["accessToken", "idToken", "email", "expiresAt", "expiresIn", "lastRefreshAt"]) {
    if (syncedCredentials[field] !== undefined && syncedCredentials[field] !== null) {
      update[field] = syncedCredentials[field];
    }
  }

  return update;
}
