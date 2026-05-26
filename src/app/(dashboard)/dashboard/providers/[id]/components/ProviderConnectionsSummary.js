export default function ProviderConnectionsSummary({
  providerId,
  autoRefreshSummary,
  selectedConnectionsCount,
  selectedAutoRefreshSummary,
  manualRefreshSummary,
}) {
  if (providerId !== "codex") return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-3 text-xs text-text-muted lg:justify-end">
      <span>{autoRefreshSummary}</span>
      {selectedConnectionsCount > 0 && (
        <span>{selectedAutoRefreshSummary}</span>
      )}
      {manualRefreshSummary && (
        <span>
          Refresh: {manualRefreshSummary.passed}/{manualRefreshSummary.total}{" "}
          success
        </span>
      )}
    </div>
  );
}
