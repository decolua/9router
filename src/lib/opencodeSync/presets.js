export const OPENCODE_SYNC_PLUGIN = "opencode-9router-sync@latest";
export const OPENAGENT_PRESET_PLUGIN = "oh-my-openagent@latest";
export const SLIM_PRESET_PLUGIN = "oh-my-opencode-slim@latest";

export const VARIANT_PRESETS = Object.freeze({
  openagent: Object.freeze({
    variant: "openagent",
    plugin: OPENAGENT_PRESET_PLUGIN,
  }),
  slim: Object.freeze({
    variant: "slim",
    plugin: SLIM_PRESET_PLUGIN,
  }),
  custom: Object.freeze({
    variant: "custom",
    plugin: null,
  }),
});

export const CUSTOM_TEMPLATE_PRESETS = Object.freeze({
  minimal: Object.freeze({
    template: "minimal",
    plugin: null,
    bundle: Object.freeze({
      advancedOverrides: Object.freeze({
        generation: Object.freeze({
          strategy: "manual",
        }),
        ui: Object.freeze({
          mode: "minimal",
        }),
      }),
    }),
  }),
  opinionated: Object.freeze({
    template: "opinionated",
    plugin: null,
    bundle: Object.freeze({
      advancedOverrides: Object.freeze({
        generation: Object.freeze({
          strategy: "assisted",
        }),
        safety: Object.freeze({
          confirmations: true,
        }),
        ui: Object.freeze({
          mode: "opinionated",
        }),
      }),
    }),
  }),
});

export function getVariantPreset(variant) {
  return VARIANT_PRESETS[variant] || null;
}

export function getCustomTemplatePreset(template) {
  if (template == null) return null;
  return CUSTOM_TEMPLATE_PRESETS[template] || null;
}
