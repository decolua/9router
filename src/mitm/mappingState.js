export function updateMappingEntry(mappings, alias, patch) {
  const current = mappings[alias] || {};
  const nextEntry = {
    ...current,
    ...patch,
  };

  if (!nextEntry.model) delete nextEntry.model;
  if (!nextEntry.reasoningEffort) delete nextEntry.reasoningEffort;

  if (!nextEntry.model && !nextEntry.reasoningEffort) {
    return Object.fromEntries(Object.entries(mappings).filter(([key]) => key !== alias));
  }

  return {
    ...mappings,
    [alias]: nextEntry,
  };
}
