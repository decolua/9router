// Pure logic extracted to be testable independently of React
export function optimisticProviderClear(snapshot, provider) {
  const next = { ...snapshot };
  const prefix = `${provider}::`;
  for (const [pId, byScope] of Object.entries(next)) {
    let changed = false;
    const newByScope = { ...byScope };
    for (const sc of Object.keys(newByScope)) {
      if (sc === `${provider}::*` || sc.startsWith(prefix)) {
        delete newByScope[sc];
        changed = true;
      }
    }
    if (changed) {
      if (Object.keys(newByScope).length === 0) {
        delete next[pId];
      } else {
        next[pId] = newByScope;
      }
    }
  }
  return next;
}

export function handleMutationBarrier(currentSnapshot, fetchedSnapshot, fetchGeneration, mutationGeneration) {
  if (fetchGeneration === mutationGeneration) {
    return fetchedSnapshot;
  }

  return currentSnapshot;
}
