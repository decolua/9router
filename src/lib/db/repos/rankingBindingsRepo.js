import { makeKv } from "../helpers/kvStore.js";

/**
 * Remembered model -> leaderboard bindings.
 *
 * Ranking a combo used to re-ask for every unmatched model on every run: the
 * user resolved a model by hand, closed the panel, and had to resolve the same
 * model again next time. This stores those decisions so the second run is
 * already correct.
 *
 * key   = the router's model id ("provider/model" or a combo member string)
 * value = the leaderboard slug it maps to, or "" for an explicit
 *         "I looked at this and want it left unranked".
 *
 * The empty string is meaningful and must not be confused with "no entry": it is
 * what stops auto-binding from re-guessing a model the user deliberately
 * excluded.
 */
const bindingsKv = makeKv("rankingBindings");

/** @returns {Promise<Object<string,string>>} model -> slug ("" = leave unranked) */
export async function getRankingBindings() {
  return await bindingsKv.getAll();
}

/** Remember one decision. `slug` of "" records an explicit "leave unranked". */
export async function setRankingBinding(model, slug) {
  await bindingsKv.set(model, slug ?? "");
}

/** Remember several decisions at once. */
export async function setRankingBindings(map) {
  await bindingsKv.setMany(map || {});
}

/** Forget one model's binding, so it is resolved fresh next time. */
export async function deleteRankingBinding(model) {
  await bindingsKv.remove(model);
}

/** Forget every binding. */
export async function clearRankingBindings() {
  await bindingsKv.clear();
}
