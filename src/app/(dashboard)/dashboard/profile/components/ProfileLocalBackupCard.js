import { Button, Card, SegmentedControl, Toggle } from "@/shared/components";
import { THEME_OPTIONS } from "../utils/profileConstants";
import { ProfileStatus } from "./ProfileStatus";

export function ProfileLocalBackupCard({
  theme,
  setTheme,
  includeUsageAnalytics,
  setIncludeUsageAnalytics,
  restoreUsageAnalytics,
  setRestoreUsageAnalytics,
  dbLoading,
  dbStatus,
  importFileRef,
  handleExportDatabase,
  handleImportDatabase,
}) {
  return (
    <Card>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="size-10 sm:size-12 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-xl sm:text-2xl">computer</span>
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">Local Mode</h2>
            <p className="text-sm text-text-muted">Running on your machine</p>
          </div>
        </div>
        <SegmentedControl
          options={THEME_OPTIONS}
          value={theme}
          onChange={setTheme}
          size="sm"
          className="w-full sm:w-auto"
        />
      </div>
      <div className="flex flex-col gap-3 pt-4 border-t border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg bg-bg border border-border gap-2">
          <div>
            <p className="font-medium text-sm sm:text-base">Database Location</p>
            <p className="text-xs sm:text-sm text-text-muted font-mono break-all">~/.9router/db/data.sqlite</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-start sm:items-center justify-between gap-4 rounded-lg border border-border bg-bg p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm sm:text-base">Include Usage & Analytics</p>
              <p className="text-xs sm:text-sm text-text-muted">
                Add token, cost, request history, and request details to the downloaded backup.
              </p>
            </div>
            <Toggle
              checked={includeUsageAnalytics}
              onChange={() => setIncludeUsageAnalytics((enabled) => !enabled)}
              disabled={dbLoading}
            />
          </div>
          <div className="flex items-start sm:items-center justify-between gap-4 rounded-lg border border-border bg-bg p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm sm:text-base">Restore Usage & Analytics</p>
              <p className="text-xs sm:text-sm text-text-muted">
                When importing a backup that contains analytics, replace the current usage history with the backup data.
              </p>
            </div>
            <Toggle
              checked={restoreUsageAnalytics}
              onChange={() => setRestoreUsageAnalytics((enabled) => !enabled)}
              disabled={dbLoading}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="secondary"
              icon="download"
              onClick={handleExportDatabase}
              loading={dbLoading}
              className="w-full sm:w-auto"
            >
              Download Backup
            </Button>
            <Button
              variant="outline"
              icon="upload"
              onClick={() => importFileRef.current?.click()}
              disabled={dbLoading}
              className="w-full sm:w-auto"
            >
              Import Backup
            </Button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportDatabase}
            />
          </div>
        </div>
        <ProfileStatus status={dbStatus} />
      </div>
    </Card>
  );
}
