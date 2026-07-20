import { createProviderConnection } from "../../../models/index.js";
import { KiroService } from "./kiro.js";

function formatSocialProvider(provider) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function buildExpiresAt(expiresIn) {
  const ttlSeconds = Number.isFinite(Number(expiresIn)) ? Number(expiresIn) : 3600;
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

export async function saveKiroOAuthConnection({
  accessToken,
  refreshToken,
  expiresIn,
  profileArn,
  authMethod,
  providerLabel,
}) {
  const kiroService = new KiroService();
  const email = kiroService.extractEmailFromJWT(accessToken);

  const connection = await createProviderConnection({
    provider: "kiro",
    authType: "oauth",
    accessToken,
    refreshToken,
    expiresAt: buildExpiresAt(expiresIn),
    email: email || null,
    providerSpecificData: {
      profileArn,
      authMethod,
      provider: providerLabel,
    },
    testStatus: "active",
  });

  return {
    id: connection.id,
    provider: connection.provider,
    email: connection.email,
  };
}

export async function exchangeAndSaveKiroSocialConnection({
  code,
  codeVerifier,
  provider = "google",
}) {
  if (!code || !codeVerifier) {
    throw new Error("Missing required social exchange fields");
  }
  if (!["google", "github"].includes(provider)) {
    throw new Error("Invalid provider");
  }

  const kiroService = new KiroService();
  const tokenData = await kiroService.exchangeSocialCode(code, codeVerifier);

  const connection = await saveKiroOAuthConnection({
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresIn: tokenData.expiresIn,
    profileArn: tokenData.profileArn,
    authMethod: provider,
    providerLabel: formatSocialProvider(provider),
  });

  return {
    connection,
    tokenData,
  };
}

export async function validateAndSaveKiroImportedToken(refreshToken) {
  const kiroService = new KiroService();
  const tokenData = await kiroService.validateImportToken(refreshToken);

  const connection = await saveKiroOAuthConnection({
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresIn: tokenData.expiresIn,
    profileArn: tokenData.profileArn,
    authMethod: "imported",
    providerLabel: "Imported",
  });

  return {
    connection,
    tokenData,
  };
}
