import { getApiKeys } from "@/lib/db/index.js";
import { resolveCliApiKey } from "@/shared/utils/cliApiKey";

// Server-side counterpart for cli-tools routes: a missing or placeholder key from the
// client falls back to a real dashboard key instead of writing "sk_9router" to disk.
export async function resolveCliApiKeyForWrite(apiKey) {
  let keys = [];
  try {
    keys = await getApiKeys();
  } catch { /* DB unavailable — resolveCliApiKey falls back to the placeholder */ }
  return resolveCliApiKey(apiKey, keys);
}
