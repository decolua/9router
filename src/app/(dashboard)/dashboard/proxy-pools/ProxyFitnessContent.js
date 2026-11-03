import { Badge, Button } from "@/shared/components";

export default function ProxyFitnessContent({
  clearing,
  fetchError,
  formatCountdown,
  getPoolName,
  loading,
  now,
  onClearExact,
  onClearProvider,
  onRetry,
  snapshot,
}) {
  let hasEntries = false;
  const providers = new Set();
  const rows = [];

  for (const [poolId, byScope] of Object.entries(snapshot)) {
    for (const [scope, entry] of Object.entries(byScope)) {
      if (entry.until > now) {
        hasEntries = true;
        const providerMatch = scope.match(/^([^:]+)::/);
        const provider = providerMatch ? providerMatch[1] : null;
        if (provider) providers.add(provider);
        rows.push({
          poolId,
          poolName: getPoolName(poolId),
          scope,
          provider,
          isWildcard: scope.endsWith("::*"),
          until: entry.until,
          reason: entry.reason || "-",
        });
      }
    }
  }

  rows.sort((a, b) => {
    const cmp = a.poolName.localeCompare(b.poolName);
    if (cmp !== 0) return cmp;
    return a.scope.localeCompare(b.scope);
  });

  if (fetchError) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
        Failed to load fitness data.
        <button
          onClick={(event) => {
            event.preventDefault();
            onRetry();
          }}
          className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading && !hasEntries) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Loading...</div>;
  }

  if (!hasEntries) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No active fitness exclusions.</div>;
  }

  return (
    <div className="space-y-6">
      {providers.size > 0 && (
        <div className="flex flex-wrap gap-2 items-center pb-4 border-b border-gray-200 dark:border-gray-800">
          <span className="text-sm text-gray-500 dark:text-gray-400 mr-2">Clear by provider:</span>
          {Array.from(providers).map((provider) => {
            const isClearingProvider = clearing.has(`provider::${provider}`);
            return (
              <Button
                key={provider}
                variant="secondary"
                size="sm"
                onClick={() => onClearProvider(provider)}
                disabled={isClearingProvider}
              >
                {isClearingProvider ? "Clearing..." : `Clear ${provider}`}
              </Button>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-500 uppercase bg-gray-100 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Pool</th>
              <th className="px-4 py-3 font-medium">Scope</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium text-right">Time Remaining</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isClearingRow = clearing.has(`${row.poolId}::${row.scope}`);
              const isClearingProvider = row.provider && clearing.has(`provider::${row.provider}`);
              const disabled = isClearingRow || isClearingProvider;
              const isExpiringSoon = row.until - now <= 60000;

              return (
                <tr key={`${row.poolId}-${row.scope}`} className="border-b border-gray-200 dark:border-gray-800 hover:bg-white dark:hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-gray-100">{row.poolName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">
                    <div className="flex items-center gap-2">
                      {row.scope}
                      {row.isWildcard && <Badge variant="warning" className="text-[10px] px-1.5 py-0">WILDCARD</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-[200px]" title={row.reason}>{row.reason}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <span className={isExpiringSoon ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-600 dark:text-gray-400"}>
                      {formatCountdown(row.until)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onClearExact(row.poolId, row.scope)}
                      disabled={disabled}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 px-2"
                      title="Clear exclusion"
                      aria-label={`Clear exclusion for ${row.poolName} scope ${row.scope}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
