import { resolveApiKeyRecord, getMonthlyUsageForKey } from "@/lib/localDb";

// Load the apiKeys record for a raw key. Returns null if no record.
// Does NOT check isActive — callers decide. Throws on DB error (auth integrity).
export async function loadKeyPolicy(rawKey) {
  if (!rawKey) return null;
  return await resolveApiKeyRecord(rawKey);
}

// Apply per-key allowlists. Empty/null lists = allow all.
// resolved = { provider, model } or null.
// Match rule: a request passes the model check if allowedModels contains
//   the raw model string OR resolved `${provider}/${model}` OR bare resolved model.
// Provider check uses the resolved provider id. The two lists AND together.
export function checkModelAllowed(record, rawModel, resolved) {
  if (!record) return { allowed: true };
  const providerAllowed = Array.isArray(record.allowedProviders) ? record.allowedProviders : [];
  const modelsAllowed = Array.isArray(record.allowedModels) ? record.allowedModels : [];
  const providerRestrictionActive = providerAllowed.length > 0;
  const modelRestrictionActive = modelsAllowed.length > 0;
  if (!providerRestrictionActive && !modelRestrictionActive) return { allowed: true };

  const candidates = new Set();
  if (rawModel) candidates.add(String(rawModel));
  if (resolved?.provider && resolved?.model) {
    candidates.add(`${resolved.provider}/${resolved.model}`);
    candidates.add(String(resolved.model));
  }

  if (providerRestrictionActive) {
    if (!resolved?.provider || !providerAllowed.includes(resolved.provider)) {
      return {
        allowed: false,
        reason: `provider '${resolved?.provider || ""}' not allowed for this key`,
      };
    }
  }
  if (modelRestrictionActive) {
    let matched = false;
    for (const c of candidates) {
      if (modelsAllowed.includes(c)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return { allowed: false, reason: `model '${rawModel}' not allowed for this key` };
    }
  }
  return { allowed: true };
}

// Pre-request monthly cap check. A request that crosses the cap mid-flight
// still completes; the NEXT request is blocked. Mid-stream metering is out of scope.
// Fail-open on transient DB error (availability over strictness for limits);
// auth elsewhere fails-closed.
export async function checkMonthlyLimits(record, rawKey) {
  if (!record) return { allowed: true };
  const tok = record.monthlyTokenLimit || 0;
  const usd = record.monthlyBudgetUsd || 0;
  if (tok <= 0 && usd <= 0) return { allowed: true };
  let usage;
  try {
    usage = await getMonthlyUsageForKey(rawKey);
  } catch {
    return { allowed: true };
  }
  if (tok > 0 && usage.tokens >= tok) {
    return { allowed: false, reason: "monthly token limit exceeded", scope: "tokens" };
  }
  if (usd > 0 && usage.cost >= usd) {
    return { allowed: false, reason: "monthly budget exceeded", scope: "budget" };
  }
  return { allowed: true };
}
