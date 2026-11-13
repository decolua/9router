import { getCombos, updateCombo } from "@/lib/db/repos/combosRepo.js";
import {
  fetchLeaderboardModels,
  matchModelsWithLeaderboard,
  validateIntelligenceConfig,
} from "./artificialAnalysis.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { resetComboRotation } from "open-sse/services/combo.js";

const SCHEDULE_INTERVALS_MS = {
  hourly: 60 * 60 * 1000,
  "6hours": 6 * 60 * 60 * 1000,
  "12hours": 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

let schedulerTimer = null;

export async function checkAndRefreshIntelligenceCombos() {
  try {
    const combos = await getCombos();
    const now = Date.now();
    let aaModels = null;
    let availableModels = null;

    for (const combo of combos) {
      const config = combo.config;
      if (!config || config.type !== "intelligence") continue;

      let validated;
      try {
        validated = validateIntelligenceConfig(config);
      } catch (error) {
        console.warn(`[ComboScheduler] Skipping invalid intelligence combo "${combo.name}": ${error.message}`);
        continue;
      }

      const schedule = validated.refreshSchedule;
      if (!schedule || schedule === "manual") continue;

      let intervalMs = SCHEDULE_INTERVALS_MS[schedule];
      if (!intervalMs && typeof config.refreshIntervalHours === "number" && config.refreshIntervalHours > 0) {
        intervalMs = config.refreshIntervalHours * 60 * 60 * 1000;
      }
      if (!intervalMs) continue;

      const lastRefreshed = config.lastRefreshedAt ? new Date(config.lastRefreshedAt).getTime() : 0;
      if (now - lastRefreshed >= intervalMs) {
        console.log(`[ComboScheduler] Auto-refreshing intelligence combo "${combo.name}" (${schedule})...`);

        if (!aaModels) {
          aaModels = await fetchLeaderboardModels({ forceRefresh: true });
        }
        if (!availableModels) {
          try {
            const all = await buildModelsList(["llm"], { configuredOnly: true });
            availableModels = (all || []).filter((m) => m && m.owned_by !== "combo");
          } catch {
            availableModels = [];
          }
        }

        const { models, details } = matchModelsWithLeaderboard({
          aaModels,
          availableModels,
          ...validated,
        });

        const refreshConfig = {
          ...config,
          lastRefreshedAt: new Date().toISOString(),
          matchedDetails: details,
        };
        const refreshed = await updateCombo(
          combo.id,
          { models, config: refreshConfig },
          { expectedUpdatedAt: combo.updatedAt }
        );
        if (!refreshed) {
          console.log(`[ComboScheduler] Skipped "${combo.name}" because it changed during refresh.`);
          continue;
        }
        resetComboRotation(combo.name);
        if (models.length === 0) {
          console.warn(`[ComboScheduler] Disabled "${combo.name}" because no configured provider models match.`);
        } else {
          console.log(`[ComboScheduler] Refreshed "${combo.name}" with ${models.length} models.`);
        }
      }
    }
  } catch (err) {
    console.warn("[ComboScheduler] Error in checkAndRefreshIntelligenceCombos:", err.message);
  }
}

export function startComboScheduler() {
  if (schedulerTimer) return;
  // Refresh overdue combos at startup; waiting for the first timer tick can make
  // hourly schedules stale for an extra 30 minutes after a process restart.
  checkAndRefreshIntelligenceCombos().catch((err) => {
    console.warn("[ComboScheduler] startup refresh failed:", err.message);
  });
  // Check every 30 minutes
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  schedulerTimer = setInterval(() => {
    checkAndRefreshIntelligenceCombos().catch(() => {});
  }, CHECK_INTERVAL_MS);
  if (schedulerTimer.unref) schedulerTimer.unref();
}

export function stopComboScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}
