import { Card, Input, Toggle } from "@/shared/components";

export function ProfileRoutingCard({
  settings,
  loading,
  updateFallbackStrategy,
  updateComboStrategy,
  updateStickyLimit,
  updateComboStickyLimit,
}) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">route</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">Routing Strategy</h3>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">Round Robin</p>
            <p className="text-xs sm:text-sm text-text-muted">Cycle through accounts to distribute load</p>
          </div>
          <Toggle
            checked={settings.fallbackStrategy === "round-robin"}
            onChange={() =>
              updateFallbackStrategy(
                settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin",
              )
            }
            disabled={loading}
          />
        </div>

        {settings.fallbackStrategy === "round-robin" && (
          <div className="flex items-start sm:items-center justify-between gap-4 pt-2 border-t border-border/50">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base">Sticky Limit</p>
              <p className="text-xs sm:text-sm text-text-muted">Calls per account before switching</p>
            </div>
            <Input
              type="number"
              min="1"
              max="10"
              value={settings.stickyRoundRobinLimit || 3}
              onChange={(e) => updateStickyLimit(e.target.value)}
              disabled={loading}
              className="w-16 sm:w-20 text-center shrink-0"
            />
          </div>
        )}

        <div className="flex items-start sm:items-center justify-between gap-4 pt-4 border-t border-border/50">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">Combo Round Robin</p>
            <p className="text-xs sm:text-sm text-text-muted">
              Cycle through providers in combos instead of always starting with first
            </p>
          </div>
          <Toggle
            checked={settings.comboStrategy === "round-robin"}
            onChange={() =>
              updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")
            }
            disabled={loading}
          />
        </div>

        {settings.comboStrategy === "round-robin" && (
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div>
              <p className="font-medium">Combo Sticky Limit</p>
              <p className="text-sm text-text-muted">Calls per combo model before switching</p>
            </div>
            <Input
              type="number"
              min="1"
              max="100"
              value={settings.comboStickyRoundRobinLimit || 1}
              onChange={(e) => updateComboStickyLimit(e.target.value)}
              disabled={loading}
              className="w-20 text-center"
            />
          </div>
        )}

        <p className="text-xs text-text-muted italic pt-2 border-t border-border/50">
          {settings.fallbackStrategy === "round-robin"
            ? `Currently distributing requests across all available accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
            : "Currently using accounts in priority order (Fill First)."}
          {settings.comboStrategy === "round-robin"
            ? ` Combos rotate after ${settings.comboStickyRoundRobinLimit || 1} call${(settings.comboStickyRoundRobinLimit || 1) === 1 ? "" : "s"} per model.`
            : " Combos always start with their first model."}
        </p>
      </div>
    </Card>
  );
}
