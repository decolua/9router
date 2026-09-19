"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Button,
  Badge,
  Toggle,
  ModelSelectModal,
  CapacityBadges,
} from "@/shared/components";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useNotificationStore } from "@/store/notificationStore";

const PLUGINS = [
  {
    key: "imageVision",
    title: "Image Vision",
    icon: "visibility",
    iconColor: "text-blue-500",
    iconBg: "bg-blue-500/10 border-blue-500/20",
    description:
      "Enable image understanding for models that don't natively support vision. Images are converted to text descriptions, allowing any model to process visual content in CLI tools and agents.",
  },
  {
    key: "thinkDeeper",
    title: "Think Deeper",
    icon: "psychology",
    iconColor: "text-purple-500",
    iconBg: "bg-purple-500/10 border-purple-500/20",
    description:
      "Enhance reasoning with multi-step chain-of-thought analysis. Forces the model to break problems into steps before answering, producing more thorough and accurate responses.",
  },
  {
    key: "unrestrictedMode",
    title: "Uncensored Output",
    icon: "key_off",
    iconColor: "text-red-500",
    iconBg: "bg-red-500/10 border-red-500/20",
    description:
      "Bypass standard AI refusals and guardrails. Injects an unrestricted direct technical directive, compelling the model to provide raw code, analysis, and uncensored answers (Note: may not work on some provider models).",
  },
  {
    key: "speedMode",
    title: "Speed Mode",
    icon: "bolt",
    iconColor: "text-cyan-500",
    iconBg: "bg-cyan-500/10 border-cyan-500/20",
    description:
      "Skip thinking for faster responses. Disables reasoning mode on the selected models and instructs them to answer directly, ideal for simple tasks where low latency matters more than deep analysis.",
  },
];

const DEFAULT_PLUGINS_STATE = {
  imageVision: { enabled: false, models: [] },
  thinkDeeper: { enabled: false, models: [] },
  unrestrictedMode: { enabled: false, models: [] },
  speedMode: { enabled: false, models: [] },
};

function formatModelName(modelVal) {
  if (!modelVal) return "";
  return modelVal.includes("/")
    ? modelVal.split("/").slice(1).join("/")
    : modelVal;
}

export default function PluginsPage() {
  const [customPlugins, setCustomPlugins] = useState(DEFAULT_PLUGINS_STATE);
  const [activeProviders, setActiveProviders] = useState([]);
  const [pickerPlugin, setPickerPlugin] = useState(null);
  const { getCaps } = useModelCaps();
  const addNotification = useNotificationStore((state) => state.addNotification);

  useEffect(() => {
    async function loadData() {
      try {
        const [pluginsRes, providersRes] = await Promise.all([
          fetch("/api/plugins", { cache: "no-store" }),
          fetch("/api/providers", { cache: "no-store" }),
        ]);

        if (pluginsRes.ok) {
          const data = await pluginsRes.json();
          if (data.customPlugins) {
            setCustomPlugins({
              imageVision: {
                enabled: Boolean(data.customPlugins.imageVision?.enabled),
                models: Array.isArray(data.customPlugins.imageVision?.models)
                  ? data.customPlugins.imageVision.models
                  : [],
              },
              thinkDeeper: {
                enabled: Boolean(data.customPlugins.thinkDeeper?.enabled),
                models: Array.isArray(data.customPlugins.thinkDeeper?.models)
                  ? data.customPlugins.thinkDeeper.models
                  : [],
              },
              unrestrictedMode: {
                enabled: Boolean(data.customPlugins.unrestrictedMode?.enabled),
                models: Array.isArray(data.customPlugins.unrestrictedMode?.models)
                  ? data.customPlugins.unrestrictedMode.models
                  : [],
              },
              speedMode: {
                enabled: Boolean(data.customPlugins.speedMode?.enabled),
                models: Array.isArray(data.customPlugins.speedMode?.models)
                  ? data.customPlugins.speedMode.models
                  : [],
              },
            });
          }
        }

        if (providersRes.ok) {
          const provData = await providersRes.json();
          setActiveProviders(provData.connections || []);
        }
      } catch (err) {
        console.error("Failed to load plugin data:", err);
      }
    }

    loadData();
  }, []);

  const savePlugins = useCallback(
    async (updatedPlugins) => {
      try {
        const res = await fetch("/api/plugins", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customPlugins: updatedPlugins }),
        });
        if (res.ok) {
          window.dispatchEvent(new Event("customModelChanged"));
        }
      } catch (err) {
        console.error("Failed to save plugins:", err);
      }
    },
    []
  );

  const handleToggle = useCallback(
    (pluginKey, enabled) => {
      setCustomPlugins((prev) => {
        const updated = {
          ...prev,
          [pluginKey]: {
            ...prev[pluginKey],
            enabled,
          },
        };
        savePlugins(updated);
        return updated;
      });
    },
    [savePlugins]
  );

  const handleAddModel = useCallback(
    (pluginKey, model) => {
      const modelVal =
        typeof model === "string"
          ? model
          : model?.value || model?.name || model?.id || "";
      if (!modelVal || !pluginKey) return;

      setCustomPlugins((prev) => {
        const currentModels = prev[pluginKey]?.models || [];
        if (currentModels.includes(modelVal)) return prev;

        const updated = {
          ...prev,
          [pluginKey]: {
            ...prev[pluginKey],
            models: [...currentModels, modelVal],
          },
        };
        savePlugins(updated);
        return updated;
      });
    },
    [savePlugins]
  );

  const handleRemoveModel = useCallback(
    (pluginKey, model) => {
      const modelVal =
        typeof model === "string"
          ? model
          : model?.value || model?.name || model?.id || "";
      if (!modelVal || !pluginKey) return;

      setCustomPlugins((prev) => {
        const currentModels = prev[pluginKey]?.models || [];
        if (!currentModels.includes(modelVal)) return prev;

        const updated = {
          ...prev,
          [pluginKey]: {
            ...prev[pluginKey],
            models: currentModels.filter((m) => m !== modelVal),
          },
        };
        savePlugins(updated);
        return updated;
      });
    },
    [savePlugins]
  );

  const activePickerConfig = PLUGINS.find((p) => p.key === pickerPlugin);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main">Custom Plugins</h1>
        <p className="text-sm text-text-muted mt-1">
          Extend model capabilities with plugins
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {PLUGINS.map((plugin) => {
          const config = customPlugins[plugin.key] || {
            enabled: false,
            models: [],
          };
          const isEnabled = config.enabled;
          const selectedModels = config.models || [];

          return (
            <Card key={plugin.key} className="flex flex-col h-full">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`size-10 rounded-xl flex items-center justify-center border shrink-0 ${plugin.iconBg}`}
                  >
                    <span
                      className={`material-symbols-outlined text-[22px] leading-none ${plugin.iconColor}`}
                    >
                      {plugin.icon}
                    </span>
                  </div>
                  <h3 className="font-semibold text-base text-text-main">
                    {plugin.title}
                  </h3>
                </div>
                <Toggle
                  checked={isEnabled}
                  onChange={(val) => handleToggle(plugin.key, val)}
                />
              </div>

              <p className="text-sm text-text-muted leading-relaxed mb-5">
                {plugin.description}
              </p>

              {isEnabled && (
                <div className="mt-auto pt-4 border-t border-border-subtle">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                      Selected Models
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="add"
                      onClick={() => setPickerPlugin(plugin.key)}
                    >
                      Add Models
                    </Button>
                  </div>

                  {selectedModels.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-border-subtle bg-surface-2/30 text-center">
                      <p className="text-xs text-text-muted">
                        Select models to apply this plugin
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selectedModels.map((modelVal) => (
                        <Badge
                          key={modelVal}
                          variant="default"
                          size="md"
                          className="font-medium bg-surface-2 text-text-main border border-border-subtle"
                        >
                          <span className="truncate max-w-[180px]">
                            {formatModelName(modelVal)}
                          </span>
                          <CapacityBadges caps={getCaps(modelVal)} />
                          <button
                            type="button"
                            onClick={() => handleRemoveModel(plugin.key, modelVal)}
                            className="text-text-muted hover:text-red-500 transition-colors cursor-pointer leading-none ml-0.5"
                            title="Remove model"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              close
                            </span>
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {pickerPlugin && (
        <ModelSelectModal
          isOpen={Boolean(pickerPlugin)}
          onClose={() => setPickerPlugin(null)}
          onSelect={(m) => handleAddModel(pickerPlugin, m)}
          onDeselect={(m) => handleRemoveModel(pickerPlugin, m)}
          activeProviders={activeProviders}
          title={`Select Models - ${activePickerConfig?.title || "Plugin"}`}
          addedModelValues={customPlugins[pickerPlugin]?.models || []}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}
