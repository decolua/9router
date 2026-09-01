import {
  MODEL_INVENTORY_REFRESH_MS,
  refreshModelInventory,
} from "./service.js";

const SCHEDULER_KEY =
  Symbol.for(
    "9router.c62.modelInventoryScheduler",
  );

function schedulerState() {
  if (!globalThis[SCHEDULER_KEY]) {
    globalThis[SCHEDULER_KEY] = {
      timer: null,
    };
  }

  return globalThis[SCHEDULER_KEY];
}

export function ensureModelInventoryScheduler() {
  const state =
    schedulerState();

  if (state.timer) {
    return state.timer;
  }

  state.timer =
    setInterval(() => {
      void refreshModelInventory({
        force: true,
        includeDynamic: true,
      }).catch((error) => {
        console.warn(
          "[C6.2][inventory] scheduled refresh failed:",
          error?.message ||
          error,
        );
      });
    }, MODEL_INVENTORY_REFRESH_MS);

  state.timer.unref?.();

  return state.timer;
}

export async function ensureModelInventoryFresh() {
  ensureModelInventoryScheduler();

  return refreshModelInventory({
    force: false,
    includeDynamic: true,
  });
}

export function getModelInventorySchedulerStatus() {
  const state =
    schedulerState();

  return {
    started:
      Boolean(state.timer),

    refreshIntervalMs:
      MODEL_INVENTORY_REFRESH_MS,
  };
}
