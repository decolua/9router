import { getApiKeyByKey } from "@/lib/db/index.js";
import { currentInference } from "@/lib/observability/requestContext.js";
import { extractClientApiKey } from "@/shared/utils/clientApiKey.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { groupKeyConnections } from "@/shared/utils/keyConnections.js";
import { updateLiveRoute } from "@/lib/observability/liveRoutes.js";

const verifiedKeys = new WeakMap();

// The outer route owns the identity. Format rewrites, combo members and budget
// admission reuse the same verified record, even when model access is unrestricted.
export async function readRequestKey(request) {
  const trace = currentInference();
  if (trace && verifiedKeys.has(trace)) return verifiedKeys.get(trace);
  const key = extractClientApiKey(request);
  const record = key ? await getApiKeyByKey(key) : null;
  if (trace) {
    trace.apiKey = key;
    trace.keyId = record?.id || null;
    trace.keyName = record?.name || null;
    updateLiveRoute(trace, { keyId: trace.keyId, keyName: trace.keyName });
    trace.connectionGroups = groupKeyConnections(
      record?.allowedConnections ?? [],
      record?.connectionProviders,
      resolveProviderId,
    );
    verifiedKeys.set(trace, record);
  }
  return record;
}
