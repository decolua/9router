import { AI_PROVIDERS } from "@/shared/constants/providers";

export function usesAwsCredentialForm(provider) {
  return AI_PROVIDERS[provider]?.credentialForm === "aws";
}

export function toProviderConnectionResponse(connection) {
  const { apiKey, accessToken, refreshToken, idToken, ...safe } = connection;

  if (!connection.providerSpecificData) {
    return safe;
  }

  // Credentials that live inside providerSpecificData must never reach the client.
  const { sessionToken, opendesignControlKey, ...providerSpecificData } = connection.providerSpecificData;
  if (!usesAwsCredentialForm(connection.provider) && opendesignControlKey === undefined) {
    return safe;
  }

  return { ...safe, providerSpecificData };
}
