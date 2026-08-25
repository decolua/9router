export async function hydrateFitnessCache({ list, remove, setPool, removeCached, now }) {
  const entries = await list();
  for (const entry of entries.filter((candidate) => candidate.until <= now)) {
    const result = await remove(entry.poolId, entry.scope);
    if (result.changes) removeCached(entry.poolId, entry.scope);
  }
  const active = entries.filter((entry) => entry.until > now);
  for (const poolId of new Set(entries.map((entry) => entry.poolId))) {
    setPool(poolId, active.filter((entry) => entry.poolId === poolId));
  }
  return true;
}
