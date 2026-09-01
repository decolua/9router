const STORE_KEY = Symbol.for(
  "9router.c62.modelInventory",
);

function createEmptySnapshot() {
  return {
    version: 1,
    generatedAt: null,
    refreshedAt: null,
    refreshIntervalMs: 60 * 60 * 1000,
    derivedState: "process-local",
    providerCount: 0,
    modelCount: 0,
    providers: [],
    models: [],
    errors: [],
  };
}

function createStore() {
  return {
    snapshot: createEmptySnapshot(),
    health: new Map(),
    inFlight: null,
  };
}

const store =
  globalThis[STORE_KEY] ||
  createStore();

if (!globalThis[STORE_KEY]) {
  globalThis[STORE_KEY] = store;
}

export function canonicalModelId(
  providerId,
  modelId,
) {
  return `${providerId}::${modelId}`;
}

export function getModelInventorySnapshot() {
  return store.snapshot;
}

export function setModelInventorySnapshot(
  snapshot,
) {
  store.snapshot = snapshot;
  return snapshot;
}

export function getRefreshInFlight() {
  return store.inFlight;
}

export function setRefreshInFlight(value) {
  store.inFlight = value;
}

export function getModelHealth(
  providerId,
  modelId,
) {
  return (
    store.health.get(
      canonicalModelId(
        providerId,
        modelId,
      ),
    ) || null
  );
}

export function setModelHealth(
  providerId,
  modelId,
  health,
) {
  store.health.set(
    canonicalModelId(
      providerId,
      modelId,
    ),
    {
      ...health,
      providerId,
      modelId,
    },
  );
}

export function healthSnapshot() {
  return Array.from(
    store.health.values(),
  );
}
