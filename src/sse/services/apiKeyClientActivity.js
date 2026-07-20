import { getApiKeyClientIdentity } from "@/lib/apiKeyClientIdentity";
import { getActiveApiKeyId, recordApiKeyClientRequest } from "@/lib/localDb";

const WARNING_INTERVAL_MS = 5000;
let lastWarningAt = 0;

function warnTrackingFailure() {
  const now = Date.now();
  if (now - lastWarningAt < WARNING_INTERVAL_MS) return;
  lastWarningAt = now;
  console.warn("[AUTH] API key client activity update failed; inference continues");
}

export async function trackApiKeyClientActivity({ request, body, apiKey, endpoint }) {
  if (!apiKey) return null;
  try {
    const apiKeyId = await getActiveApiKeyId(apiKey);
    if (!apiKeyId) return null;
    const identity = await getApiKeyClientIdentity(request, body);
    if (!identity) return null;
    return await recordApiKeyClientRequest(
      apiKeyId,
      identity,
      endpoint || new URL(request.url).pathname,
    );
  } catch {
    warnTrackingFailure();
    return null;
  }
}
