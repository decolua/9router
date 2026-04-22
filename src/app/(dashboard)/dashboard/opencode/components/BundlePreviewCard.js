"use client";

import { useState } from "react";
import { Badge, Button, Card, Select } from "@/shared/components";
import { sanitizeSensitiveConfig } from "@/lib/opencodeSync/schema";
import { cn } from "@/shared/utils/cn";

const PUBLIC_ARTIFACTS_COPY = "Only server-provided public artifacts appear here.";

function getMissingMainArtifactCopy() {
  return `${PUBLIC_ARTIFACTS_COPY} The server did not provide a public opencode.json preview for this bundle yet, so there is no main artifact to copy or download.`;
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function downloadTextFile(content, filename) {
  if (typeof window === "undefined") return;

  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getOpenCodeArtifact(preview = {}) {
  if (preview?.opencode && typeof preview.opencode === "object" && !Array.isArray(preview.opencode)) {
    return {
      id: "opencode",
      label: "opencode.json",
      title: "OpenCode config",
      filename: "opencode.json",
      description: "Use this as ~/.config/opencode/opencode.json.",
      content: preview.opencode,
    };
  }

  return null;
}

function getSelectedVariantArtifact(preview = {}, selectedVariant = "custom") {
  if (
    selectedVariant === "openagent" &&
    preview?.ohMyOpencode &&
    typeof preview.ohMyOpencode === "object" &&
    !Array.isArray(preview.ohMyOpencode)
  ) {
    return {
      id: "advanced",
      label: "Preset artifact",
      title: "Oh My Open Agent config",
      filename: "oh-my-openagent.json",
      description: "Selected preset artifact for the recommended Open Agent variant.",
      content: preview.ohMyOpencode,
      badge: "Oh My Open Agent",
    };
  }

  if (
    selectedVariant === "slim" &&
    preview?.ohMyOpenCodeSlim &&
    typeof preview.ohMyOpenCodeSlim === "object" &&
    !Array.isArray(preview.ohMyOpenCodeSlim)
  ) {
    return {
      id: "advanced",
      label: "Preset artifact",
      title: "Oh My OpenCode Slim config",
      filename: "oh-my-opencode-slim.json",
      description: "Selected preset artifact for the slim variant.",
      content: preview.ohMyOpenCodeSlim,
      badge: "Oh My OpenCode Slim",
    };
  }

  return null;
}

function getDefaultModelLabel(opencodeConfig = {}) {
  if (typeof opencodeConfig?.model !== "string" || !opencodeConfig.model.trim()) {
    return "Not configured";
  }

  const model = opencodeConfig.model.trim();
  const [, ...rest] = model.split("/");
  return rest.length > 0 ? rest.join("/") : model;
}

function getProviderModelCount(opencodeConfig = {}) {
  const providerEntries = Object.values(opencodeConfig?.provider || {});
  return providerEntries.reduce((count, provider) => count + Object.keys(provider?.models || {}).length, 0);
}

function StatTile({ label, value, note, icon }) {
  return (
    <div className="rounded-[24px] border border-black/5 bg-white/[0.78] px-[1.125rem] py-4 shadow-[0_10px_30px_rgba(0,0,0,0.03)] dark:border-white/5 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{label}</p>
          <p className="text-sm font-semibold text-text-main break-all">{value}</p>
          {note ? <p className="text-xs text-text-muted">{note}</p> : null}
        </div>
        <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
      </div>
    </div>
  );
}

function ConfigViewTabs({ views, activeView, onChange }) {
  return (
    <>
      <div className="sm:hidden">
        <Select
          label="Config view"
          value={activeView}
          onChange={(event) => onChange(event.target.value)}
          options={views.map((view) => ({ value: view.id, label: view.label }))}
        />
      </div>

      <div className="hidden flex-wrap gap-2 sm:flex">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => onChange(view.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
              activeView === view.id
                ? "border-primary bg-primary/10 text-primary shadow-sm"
                : "border-black/8 bg-transparent text-text-muted hover:border-primary/30 hover:text-text-main dark:border-white/10"
            )}
          >
            {view.label}
          </button>
        ))}
      </div>
    </>
  );
}

export default function BundlePreviewCard({ preview, selectedVariant = "custom", loading = false, error = "", onRefresh }) {
  const safePreview = sanitizeSensitiveConfig(preview || null);
  const opencodeArtifact = getOpenCodeArtifact(safePreview);
  const opencodeConfig = opencodeArtifact?.content || null;
  const selectedVariantArtifact = getSelectedVariantArtifact(safePreview, selectedVariant);
  const catalogModels = Array.isArray(safePreview?.catalogModels) ? safePreview.catalogModels : [];
  const modelCount = getProviderModelCount(opencodeConfig) || catalogModels.length;
  const pluginList = Array.isArray(opencodeConfig?.plugin) ? opencodeConfig.plugin : [];

  const views = [
    ...(opencodeArtifact ? [opencodeArtifact] : []),
    ...(selectedVariantArtifact ? [selectedVariantArtifact] : []),
  ];
  const hasMainArtifact = Boolean(opencodeArtifact);
  const fallbackSecondaryViewId = views.find((view) => view.id !== "opencode")?.id || null;

  const [activeView, setActiveView] = useState("opencode");
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMoreViews, setShowMoreViews] = useState(false);

  const resolvedActiveView = views.some((view) => view.id === activeView)
    ? activeView
    : hasMainArtifact
      ? "opencode"
      : fallbackSecondaryViewId;
  const currentView = resolvedActiveView ? views.find((view) => view.id === resolvedActiveView) || null : null;
  const currentContent = currentView ? prettyJson(currentView.content) : "";
  const primaryViews = views.filter((view) => view.id === "opencode");
  const secondaryViews = views.filter((view) => view.id !== "opencode");

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;

    if (!currentView) return;

    await navigator.clipboard.writeText(currentContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Card
      title="Generated config files"
      subtitle={hasMainArtifact ? "Quick Start starts with the server-provided opencode.json artifact." : PUBLIC_ARTIFACTS_COPY}
      icon="data_object"
      className="rounded-[26px] border-primary/10 bg-gradient-to-br from-white/[0.82] via-surface to-surface shadow-[0_22px_60px_rgba(0,0,0,0.06)] dark:from-white/[0.02]"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {hasMainArtifact ? (
            <Button variant="secondary" size="sm" onClick={() => downloadTextFile(prettyJson(opencodeConfig), "opencode.json")}>
              Download opencode.json
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onRefresh} loading={loading}>
            Refresh preview
          </Button>
        </div>
      }
    >
      <div className="space-y-7">
        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <StatTile
            label="Variant"
            value={selectedVariantArtifact?.badge || "Custom / No preset"}
            note={selectedVariantArtifact ? "Preset artifact available" : hasMainArtifact ? "Main config only" : "No public artifact"}
            icon="layers"
          />
          <StatTile
            label="Default model"
            value={getDefaultModelLabel(opencodeConfig)}
            note={`${modelCount} models`}
            icon="model_training"
          />
          <StatTile
            label="Plugins"
            value={`${pluginList.length} package${pluginList.length === 1 ? "" : "s"}`}
            note={pluginList.length > 0 ? pluginList.join(" • ") : "No plugins"}
            icon="extension"
          />
          <StatTile
            label="Version"
            value={safePreview?.version || "Not available"}
            note="Public sync contract"
            icon="fingerprint"
          />
        </div>

        <Card.Section className="space-y-6 rounded-[26px] border border-primary/10 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="primary">Quick Start-aligned</Badge>
                <Badge>{modelCount} models</Badge>
                <Badge>{pluginList.length} plugins</Badge>
                <Badge>{selectedVariantArtifact?.badge || "No preset artifact"}</Badge>
              </div>
              <div>
                <h4 className="text-base font-semibold text-text-main">Choose the file you want to copy</h4>
                <p className="text-sm leading-6 text-text-muted">This preview centers the real generated opencode.json artifact first. {PUBLIC_ARTIFACTS_COPY}</p>
              </div>
            </div>
          </div>

          {hasMainArtifact ? (
            <ConfigViewTabs views={primaryViews} activeView={resolvedActiveView} onChange={setActiveView} />
          ) : (
            <div className="rounded-[24px] border border-dashed border-black/8 bg-black/[0.015] p-[1.125rem] text-sm text-text-muted dark:border-white/10 dark:bg-white/[0.015]">
              {getMissingMainArtifactCopy()}
            </div>
          )}

          {secondaryViews.length > 0 ? (
            <div className="space-y-3 rounded-[24px] border border-dashed border-black/8 bg-black/[0.015] p-[1.125rem] dark:border-white/10 dark:bg-white/[0.015]">
              <button
                type="button"
                onClick={() => {
                  setShowMoreViews((value) => {
                    const nextValue = !value;
                    if (!nextValue && secondaryViews.some((view) => view.id === resolvedActiveView)) {
                      setActiveView(hasMainArtifact ? "opencode" : fallbackSecondaryViewId || "opencode");
                    }
                    return nextValue;
                  });
                }}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div>
                  <p className="text-sm font-semibold text-text-main">More generated artifacts</p>
                  <p className="mt-1 text-xs text-text-muted">Only true public artifacts beyond opencode.json stay secondary.</p>
                </div>
                <span
                  className={cn(
                    "material-symbols-outlined text-[18px] text-text-muted transition-transform duration-200",
                    showMoreViews ? "rotate-180" : "rotate-0"
                  )}
                >
                  expand_more
                </span>
              </button>

              {showMoreViews ? (
                <div className="space-y-3">
                  <ConfigViewTabs
                    views={secondaryViews}
                    activeView={resolvedActiveView || secondaryViews[0]?.id || "advanced"}
                    onChange={setActiveView}
                  />
                  <p className="text-xs text-text-muted">{PUBLIC_ARTIFACTS_COPY}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {currentView && resolvedActiveView ? (
            <button
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              className="flex items-center gap-2 rounded-full px-1 text-xs font-medium text-text-muted transition-colors hover:text-text-main"
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[16px] transition-transform duration-200",
                  isExpanded ? "rotate-90" : "rotate-0"
                )}
              >
                chevron_right
              </span>
              {isExpanded ? "Hide file contents" : "Show file contents"}
            </button>
          ) : null}

          {isExpanded && currentView && resolvedActiveView ? (
            <div className="grid gap-5 2xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
              <div className="space-y-5 rounded-[24px] border border-black/5 bg-surface px-5 py-5 shadow-[0_12px_34px_rgba(0,0,0,0.04)] dark:border-white/5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Current view</p>
                  <h4 className="mt-1 text-base font-semibold text-text-main">{currentView?.title}</h4>
                  <p className="mt-1 text-sm text-text-muted">{currentView?.description}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-3 dark:border-white/5 dark:bg-white/[0.02]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Filename</p>
                    <p className="mt-1 text-sm font-medium text-text-main break-all">{currentView?.filename}</p>
                  </div>
                  <div className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-3 dark:border-white/5 dark:bg-white/[0.02]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Contains</p>
                    <p className="mt-1 text-sm font-medium text-text-main">
                      {Array.isArray(currentView?.content)
                        ? `${currentView.content.length} items`
                        : `${Object.keys(currentView?.content || {}).length} top-level keys`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <Button variant="primary" size="sm" onClick={() => downloadTextFile(currentContent, currentView?.filename || "config.json")}>
                    Download this file
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleCopy}>
                    {copied ? "Copied" : "Copy file contents"}
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-black/5 bg-[#0b1020] shadow-[0_24px_70px_rgba(8,15,35,0.2)] dark:border-white/5">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Preview</p>
                    <p className="text-sm font-semibold text-slate-100">{currentView?.filename}</p>
                  </div>
                  <Badge className="bg-white/8 text-slate-200" size="sm">
                    sanitized
                  </Badge>
                </div>

                <pre className="max-h-[42rem] overflow-auto px-5 py-5 text-xs leading-6 text-slate-100">
                  <code>{currentContent}</code>
                </pre>
              </div>
            </div>
          ) : null}
        </Card.Section>
      </div>
    </Card>
  );
}
