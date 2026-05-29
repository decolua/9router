import { Card, Toggle } from "@/shared/components";

export function ProfileObservabilityCard({ observabilityEnabled, loading, updateObservabilityEnabled }) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">monitoring</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">Observability</h3>
      </div>
      <div className="flex items-start sm:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm sm:text-base">Enable Observability</p>
          <p className="text-xs sm:text-sm text-text-muted">
            Record request details for inspection in the logs view
          </p>
        </div>
        <Toggle checked={observabilityEnabled} onChange={updateObservabilityEnabled} disabled={loading} />
      </div>
    </Card>
  );
}
