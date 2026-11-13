import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * Check whether an AWS SSO cache entry looks like a Kiro token.
 * Accepts Builder ID (aorAAAAAG prefix), external_idp (Microsoft Entra),
 * and organization tokens with codewhisperer scopes.
 */
export function isKiroToken(data) {
  if (!data?.refreshToken) return false;
  if (data.refreshToken.startsWith("aorAAAAAG")) return true;
  if (data.authMethod === "external_idp") return true;
  if (Array.isArray(data.scopes) && data.scopes.some(s => s.includes("codewhisperer"))) return true;
  return false;
}

/**
 * Scan AWS SSO cache and resolve full Kiro credentials.
 * If targetRefreshToken is provided, it only returns a match for that specific token.
 * Otherwise, it returns the first found Kiro token.
 */
export async function resolveKiroCredentialsFromCache(targetRefreshToken = null) {
  const cachePath = join(homedir(), ".aws/sso/cache");
  let files;
  try {
    files = await readdir(cachePath);
  } catch (error) {
    throw new Error("AWS SSO cache not found. Please login to Kiro IDE first.");
  }

  let refreshToken = null;
  let foundFile = null;
  let tokenData = null;

  const checkData = (data, file) => {
    if (isKiroToken(data)) {
      if (targetRefreshToken && data.refreshToken !== targetRefreshToken) {
        return false;
      }
      refreshToken = data.refreshToken;
      foundFile = file;
      tokenData = data;
      return true;
    }
    return false;
  };

  const kiroTokenFile = "kiro-auth-token.json";
  if (files.includes(kiroTokenFile)) {
    try {
      const content = await readFile(join(cachePath, kiroTokenFile), "utf-8");
      checkData(JSON.parse(content), kiroTokenFile);
    } catch (error) {}
  }

  if (!refreshToken) {
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await readFile(join(cachePath, file), "utf-8");
        if (checkData(JSON.parse(content), file)) break;
      } catch (error) {
        continue;
      }
    }
  }

  if (!refreshToken) {
    throw new Error(targetRefreshToken 
      ? "Provided refresh token not found in local AWS SSO cache." 
      : "Kiro token not found in AWS SSO cache. Please login to Kiro IDE first.");
  }

  let clientId = null;
  let clientSecret = null;
  const region = tokenData?.region || null;
  const authMethod = tokenData?.authMethod || null;

  if (tokenData?.clientIdHash) {
    const clientFile = `${tokenData.clientIdHash}.json`;
    try {
      const clientContent = await readFile(join(cachePath, clientFile), "utf-8");
      const clientData = JSON.parse(clientContent);
      if (clientData.clientId && clientData.clientSecret) {
        clientId = clientData.clientId;
        clientSecret = clientData.clientSecret;
      }
    } catch (error) {}
  }

  let profileArn = null;
  const kiroProfilePaths = [
    join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Kiro", "User", "globalStorage", "kiro.kiroagent", "profile.json"),
    join(homedir(), ".config", "Kiro", "User", "globalStorage", "kiro.kiroagent", "profile.json"),
  ];
  for (const profilePath of kiroProfilePaths) {
    try {
      const profileContent = await readFile(profilePath, "utf-8");
      const profileData = JSON.parse(profileContent);
      if (profileData.arn) {
        profileArn = profileData.arn.replace(/arn:aws:codewhisperer:[^:]+:/, "arn:aws:codewhisperer:us-east-1:");
        break;
      }
    } catch (error) {
      continue;
    }
  }

  const rawAuth = authMethod === "external_idp" ? {
    auth_method: tokenData.authMethod,
    access_token: tokenData.accessToken,
    refresh_token: tokenData.refreshToken,
    client_id: tokenData.clientId || clientId,
    token_endpoint: tokenData.tokenEndpoint,
    scopes: tokenData.scopes,
    region: tokenData.region,
    profile_arn: profileArn,
    ...(tokenData.expiresAt ? { expired: tokenData.expiresAt } : {}),
  } : undefined;

  return {
    refreshToken,
    source: foundFile,
    clientId,
    clientSecret,
    region,
    authMethod,
    profileArn,
    rawAuth
  };
}
