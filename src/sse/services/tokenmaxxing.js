import { getProviderConnections } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { parseModel } from "./model.js";
import { scoreQuotas, orderByScore } from "open-sse/services/tokenmaxxing.js";

const TTL = 60_000;
const ERR_TTL = 10_000; // failed fetch retried sooner
const fresh = (h) => h && Date.now() - h.t < (h.err ? ERR_TTL : TTL);
 // ponytail: per-process cache; add shared cache if multi-instance
const cache = new Map();

async function connScore(c) {
  const hit = cache.get(c.id);
  if (fresh(hit)) return hit.s;
  let s = null, err = false;
  try {
    const u = await getUsageForProvider(c); // ponytail: no token refresh; expired token -> unknown score
    s = scoreQuotas(Object.entries(u?.quotas || {}).map(([name, q]) => ({ name, ...q })));
  } catch { err = true; }
  cache.set(c.id, { t: Date.now(), s, err });
  return s;
}

// Best account score per provider; model score = its provider's best account.
export async function resolveTokenmaxxingOrder(models, log) {
  const byProvider = {};
  const scores = {};
  for (const m of models) {
    const { provider } = parseModel(m);
    if (!provider) continue;
    byProvider[provider] ??= Promise.all(
      (await getProviderConnections({ provider, isActive: true })).map(connScore)
    ).then((r) => { const k = r.filter((x) => x != null); return k.length ? Math.max(...k) : null; });
    scores[m] = await byProvider[provider];
  }
  log?.info("COMBO", `tokenmaxxing scores: ${JSON.stringify(scores)}`);
  return orderByScore(models, scores);
}

// Connection with the highest known positive score for a provider (cached), else null.
export async function bestConnectionId(provider) {
  const conns = await getProviderConnections({ provider, isActive: true });
  const scores = await Promise.all(conns.map(connScore));
  let best = null, top = 0;
  scores.forEach((s, i) => { if (s != null && s > top) { top = s; best = conns[i].id; } });
  return best;
}
