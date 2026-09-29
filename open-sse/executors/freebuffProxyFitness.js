import { ADAPTIVE_FAILURE_ACTION, classifyAdaptiveFailure } from "../services/adaptiveFailureClassifier.js";
import { markPoolUnfit, POOL_UNFIT_MS } from "../services/proxyPoolFitness.js";

function selectedPoolId(proxyOptions) { const value = proxyOptions?.proxyPoolId; return typeof value === "string" && value.trim() ? value : null; }
function safeProperty(value, key) { try { return value?.[key]; } catch { return undefined; } }
function transportProvenance(error, clientSignal) { if (clientSignal?.aborted) return "client_abort"; const name = safeProperty(error, "name"); return name === "AbortError" || name === "TimeoutError" ? "timeout_before_response" : "proxy_connect"; }
export function hasTrustedRelayFailure(response) { const marker = response?.headers?.get?.("x-9router-relay-error"); return typeof marker === "string" && /(?:proxy|relay|tunnel|connect)/i.test(marker); }
export function selectedFreebuffPoolId(proxyOptions) { return selectedPoolId(proxyOptions); }
export async function markFreebuffPoolFailure({ model, proxyOptions, stage, error, status, provenance, signal }) {
  const poolId = selectedPoolId(proxyOptions);
  if (!poolId) return null;
  const classification = classifyAdaptiveFailure({ status, error: error ?? "Freebuff proxy failure", provider: "freebuff", model, selectedPoolId: poolId, stage, provenance: provenance || transportProvenance(error, signal) });
  if (classification.action !== ADAPTIVE_FAILURE_ACTION.POOL_UNFIT) return null;
  const until = Date.now() + POOL_UNFIT_MS;
  const committed = await markPoolUnfit(poolId, `freebuff::${model}`, until, classification.reason);
  return { poolId, scope: `freebuff::${model}`, reason: classification.reason, fitnessVersion: committed?.version ?? 0, until: committed?.until ?? until };
}
