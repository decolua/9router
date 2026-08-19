import { getSettings } from "@/lib/localDb.js";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";

export async function validateCodexNativeClient(request) {
  const settings = await getSettings();
  const apiKey = extractApiKey(request);

  // Match the authentication semantics used by every existing /v1 endpoint:
  // local deployments may opt out, while requireApiKey validates the same key store.
  if (!settings.requireApiKey) return { ok: true, apiKey: apiKey || null };
  if (!apiKey) return { ok: false, status: 401, message: "Missing API key" };
  if (!await isValidApiKey(apiKey)) {
    return { ok: false, status: 401, message: "Invalid API key" };
  }
  return { ok: true, apiKey };
}

export function codexNativeAuthError(auth) {
  return Response.json({
    error: {
      type: "authentication_error",
      code: "invalid_api_key",
      message: auth.message,
    },
  }, { status: auth.status || 401 });
}
