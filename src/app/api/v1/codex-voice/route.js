import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { extractApiKey, getProviderCredentials, clearAccountError } from "@/sse/services/auth.js";
import { enforceKeyAccessResolved } from "@/sse/services/keyAccess.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { createCodexRealtimeBridge } from "open-sse/handlers/codexRealtimeBridge.js";
import { wrapCodexRealtimePcm } from "open-sse/handlers/codexRealtimePcm.js";
import { createRealtimeSessions } from "@/sse/handlers/realtimeSessions.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createRealtimeSessions({
  async authenticate(request) {
    const record = await getApiKeyByKey(extractApiKey(request));
    return record?.isActive ? record.id : null;
  },
  async authorize(request, key) {
    const record = await getApiKeyByKey(extractApiKey(request));
    if (!record?.isActive || record.id !== key) return Response.json({ error: "Invalid API key" }, { status: 401 });
    const context = record.access?.restricted ? { keyId: record.id, keyName: record.name || record.id, allow: record.access.allow || [], _sets: null } : null;
    return enforceKeyAccessResolved(context, "cx/gpt-live-1-codex", "codex", "gpt-live-1-codex");
  },
  async connect(signal, format) {
    let credentials = await getProviderCredentials("codex", new Set(), "gpt-live-1-codex");
    if (!credentials || credentials.allRateLimited) throw Object.assign(new Error("No account available"), { status: 503 });
    credentials = await checkAndRefreshToken("codex", credentials);
    const proxyOptions = await resolveConnectionProxyConfig(credentials._connection?.providerSpecificData || credentials.providerSpecificData);
    let bridge;
    try {
      bridge = await createCodexRealtimeBridge({ credentials, signal, proxyOptions });
    } catch (error) {
      if (error.status !== 401 || !credentials.refreshToken || signal.aborted) throw error;
      const previous = credentials.accessToken;
      credentials = await checkAndRefreshToken("codex", credentials, { force: true });
      if (credentials.accessToken === previous) throw error;
      bridge = await createCodexRealtimeBridge({ credentials, signal, proxyOptions });
    }
    try { await clearAccountError(credentials.connectionId, credentials, "gpt-live-1-codex"); }
    catch (error) { await bridge.close(); throw error; }
    if (format === "pcm16") {
      try { return wrapCodexRealtimePcm(bridge); }
      catch (error) { await bridge.close(); throw error; }
    }
    return bridge;
  },
});

export const POST = handle;
export const DELETE = handle;