import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

export function sortConnections(connections, sort, usageCounts = {}) {
  const list = [...connections];

  // Most-used first (7d request count); ties keep the priority order below.
  if (sort === "usage") {
    const byPriority = sortConnections(list, "priority");
    return byPriority.sort((a, b) => (usageCounts[b.id] || 0) - (usageCounts[a.id] || 0));
  }

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
      const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });
  }

  return list.sort((a, b) => {
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider || "");
  });
}
