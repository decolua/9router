import { AI_PROVIDERS } from "@/shared/constants/providers";

export function usesAwsCredentialForm(provider) {
  return AI_PROVIDERS[provider]?.credentialForm === "aws";
}

export function toProviderConnectionResponse(connection) {
  const { apiKey, accessToken, refreshToken, idToken, ...safe } = connection;

  if (!connection.providerSpecificData) {
    return safe;
  }

  const { sessionToken, zcodeJwtToken, zaiBusinessToken, zaiRefreshToken, individualCodingPlanApiKey, teamCodingPlanApiKey, _captchaVerifyParam, ...providerSpecificData } = connection.providerSpecificData;
  if (!usesAwsCredentialForm(connection.provider) && zcodeJwtToken === undefined && zaiBusinessToken === undefined && zaiRefreshToken === undefined && individualCodingPlanApiKey === undefined && teamCodingPlanApiKey === undefined && _captchaVerifyParam === undefined) {
    return safe;
  }
  return { ...safe, providerSpecificData };
}
