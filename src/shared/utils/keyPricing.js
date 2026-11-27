// Per-API-key spend limit, priced-only rule: a limit is meaningful only when
// every model the key can reach has a price (an unpriced model records cost 0,
// so it would slip under any cap). Pure: all lookups are injected.
import { stripThinkingSuffix } from "../../../open-sse/translator/concerns/thinkingUnified.js";

/**
 * Models a key can reach, as [{ provider, model }]. null = unbounded
 * (unrestricted key: it can reach every model on the gateway). Combo names in
 * the allow list expand to their members; thinking suffixes stay on `model`.
 * @param {{restricted: boolean, allow: string[]}} access
 * @param {{ getCombos: () => Promise<{name: string, models: string[]}[]>,
 *           resolveModel: (entry: string) => Promise<{provider?: string, model?: string}|null> }} deps
 */
export async function reachableModels(access, deps) {
  if (!access?.restricted) return null;
  const combos = new Map((await deps.getCombos()).map((c) => [String(c.name).toLowerCase(), c]));
  const out = new Map();
  const add = async (entry) => {
    const info = await deps.resolveModel(entry);
    if (info?.provider && info.model) out.set(`${info.provider}/${info.model}`.toLowerCase(), { provider: info.provider, model: info.model });
    else out.set(`?/${String(entry).toLowerCase()}`, { provider: null, model: String(entry) });
  };
  for (const entry of access.allow || []) {
    const combo = combos.get(String(entry).toLowerCase());
    if (combo) for (const member of combo.models || []) await add(member);
    else await add(entry);
  }
  return [...out.values()];
}

/**
 * @returns {Promise<{ eligible: boolean, unbounded: boolean, unpriced: string[] }>}
 * `eligible` is true only when the key is bounded and every reachable model has
 * a price. `unpriced` names the models without one.
 */
export async function unpricedModels(access, deps) {
  const models = await reachableModels(access, deps);
  if (models === null) return { eligible: false, unbounded: true, unpriced: [] };
  const unpriced = [];
  for (const m of models) {
    const priced = m.provider ? await deps.getPricing(m.provider, stripThinkingSuffix(m.model)) : null;
    if (!priced) unpriced.push(m.provider ? `${m.provider}/${m.model}` : m.model);
  }
  return { eligible: unpriced.length === 0, unbounded: false, unpriced };
}
