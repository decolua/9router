export function migrateCodexFeatureFlags(config) {
  if (!config || typeof config !== "object") return config;

  const features = config.features;
  if (!features || typeof features !== "object") return config;
  if (!Object.prototype.hasOwnProperty.call(features, "codex_hooks")) return config;

  if (!Object.prototype.hasOwnProperty.call(features, "hooks")) {
    features.hooks = features.codex_hooks;
  }
  delete features.codex_hooks;

  return config;
}
