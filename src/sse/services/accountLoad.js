import { getPendingCount } from "@/lib/db/repos/usageRepo.js";
import { validWeight, MIN_WEIGHT } from "@/shared/constants/accountRouting.js";

const selecting = new Map();
const scores = new Map();

// Cover the interval from selection under the mutex to chatCore counting the dispatch.
export function holdSelection(id) {
  selecting.set(id, (selecting.get(id) || 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = selecting.get(id) - 1;
    if (left) selecting.set(id, left);
    else selecting.delete(id);
  };
}

export function leastBusy(eligible) {
  const load = c => getPendingCount(c.id) + (selecting.get(c.id) || 0);
  return eligible.reduce((best, c) => load(c) < load(best) ? c : best);
}

// Smooth WRR: each eligible peer accrues its weight; the winner spends the sum.
export function weightedChoice(provider, eligible, outOfScope = []) {
  const previous = scores.get(provider);
  const next = new Map();
  for (const connection of outOfScope) {
    if (previous?.has(connection.id)) next.set(connection.id, previous.get(connection.id));
  }
  let total = 0, winner = null;
  for (const c of eligible) {
    const weight = validWeight(c.weight) ? c.weight : MIN_WEIGHT;
    next.set(c.id, (previous?.get(c.id) || 0) + weight);
    total += weight;
    if (!winner || next.get(c.id) > next.get(winner.id)) winner = c;
  }
  next.set(winner.id, next.get(winner.id) - total);
  scores.set(provider, next);
  return winner;
}
