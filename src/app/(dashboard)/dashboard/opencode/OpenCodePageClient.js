"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, CardSkeleton, Select } from "@/shared/components";
import { getModelsByProviderId } from "@/shared/constants/models";
import AdvancedOverridesCard from "./components/AdvancedOverridesCard";
import BundlePreviewCard from "./components/BundlePreviewCard";
import EnvVarsCard from "./components/EnvVarsCard";
import McpServersCard from "./components/McpServersCard";
import ModelSelectionCard from "./components/ModelSelectionCard";
import PluginsCard from "./components/PluginsCard";
import TokenManagerCard from "./components/TokenManagerCard";
import VariantCard from "./components/VariantCard";

const TEMPLATE_OPTIONS = [
  { value: "minimal", label: "Minimal" },
  { value: "opinionated", label: "Opinionated" },
];

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

export default function OpenCodePageClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState(null);
  const [preview, setPreview] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [savingKey, setSavingKey] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [tokenCreating, setTokenCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState("");

  const modelCatalog = useMemo(() => {
    const providerModels = getModelsByProviderId("opencode") || [];
    const modelIds = providerModels.map((item) => item?.id).filter(Boolean);
    const previewModelIds = preview?.preview?.modelIds || [];
    const included = preferences?.includedModels || [];
    const excluded = preferences?.excludedModels || [];
    return Array.from(new Set([...modelIds, ...previewModelIds, ...included, ...excluded])).sort((a, b) => a.localeCompare(b));
  }, [preferences?.excludedModels, preferences?.includedModels, preview?.preview?.modelIds]);

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError("");

    try {
      const previewRes = await fetch("/api/opencode/bundle/preview", { cache: "no-store" });
      const previewData = await previewRes.json();

      if (!previewRes.ok) {
        throw new Error(previewData?.error || "Failed to load OpenCode bundle preview");
      }

      setPreview(previewData);
    } catch (loadError) {
      setPreviewError(getErrorMessage(loadError, "Failed to load OpenCode bundle preview"));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const loadTokens = useCallback(async () => {
    const response = await fetch("/api/opencode/sync/tokens", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || "Failed to load OpenCode sync tokens");
    }

    setTokens(data.tokens || []);
  }, []);

  const savePreferences = useCallback(async (patch, saveLabel = "saving") => {
    setSavingKey(saveLabel);
    setError("");
    setCreatedToken("");

    try {
      const response = await fetch("/api/opencode/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to update OpenCode preferences");
      }

      setPreferences(data.preferences || null);
      await refreshPreview();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Failed to update OpenCode preferences"));
      throw saveError;
    } finally {
      setSavingKey("");
    }
  }, [refreshPreview]);

  const createToken = useCallback(async ({ name, mode }) => {
    setTokenCreating(true);
    setTokenError("");
    setCreatedToken("");

    try {
      const response = await fetch("/api/opencode/sync/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, mode }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to create sync token");
      }

      setCreatedToken(data.token || "");
      await loadTokens();
    } catch (createError) {
      setTokenError(getErrorMessage(createError, "Failed to create sync token"));
    } finally {
      setTokenCreating(false);
    }
  }, [loadTokens]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const [preferencesRes, previewRes, tokensRes] = await Promise.all([
          fetch("/api/opencode/preferences"),
          fetch("/api/opencode/bundle/preview"),
          fetch("/api/opencode/sync/tokens"),
        ]);

        const [preferencesData, previewData, tokensData] = await Promise.all([
          preferencesRes.json(),
          previewRes.json(),
          tokensRes.json(),
        ]);

        if (!preferencesRes.ok) {
          throw new Error(preferencesData?.error || "Failed to load OpenCode preferences");
        }

        if (!previewRes.ok) {
          throw new Error(previewData?.error || "Failed to load OpenCode bundle preview");
        }

        if (!tokensRes.ok) {
          throw new Error(tokensData?.error || "Failed to load OpenCode sync tokens");
        }

        if (cancelled) return;

        setPreferences(preferencesData.preferences || null);
        setPreview(previewData);
        setTokens(tokensData.tokens || []);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError?.message || "Failed to load OpenCode control plane");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="OpenCode control plane"
        subtitle="Build a server-backed OpenCode sync bundle with guided presets, models, plugins, tokens, and advanced overrides."
        icon="extension"
        action={
          <Button variant="secondary" size="sm" onClick={refreshPreview} loading={previewLoading}>
            Refresh
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Card.Section>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                <span className="material-symbols-outlined text-[20px]">cloud_sync</span>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text-main">VPS control plane</h3>
                <p className="text-sm text-text-muted">
                  OpenCode preferences are stored server-side so a remote control plane can publish a consistent sync bundle.
                </p>
              </div>
            </div>
          </Card.Section>

          <Card.Section>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                <span className="material-symbols-outlined text-[20px]">desktop_windows</span>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text-main">Local plugin apply</h3>
                <p className="text-sm text-text-muted">
                  The generated preview shows what the local OpenCode plugin will apply on the workstation without exposing secrets in the dashboard.
                </p>
              </div>
            </div>
          </Card.Section>

          <Card.Section>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                <span className="material-symbols-outlined text-[20px]">deployed_code</span>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text-main">Guided builder</h3>
                <p className="text-sm text-text-muted">
                  Save each section through the new preferences API and verify the exact resolved bundle in the live preview.
                </p>
              </div>
            </div>
          </Card.Section>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}

        {savingKey ? <p className="mt-4 text-sm text-text-muted">Saving {savingKey}…</p> : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-6">
          <Card title="Choose a variant" subtitle="Pick a preset baseline, then customize the generated server bundle." icon="auto_awesome">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <VariantCard
                  title="Oh My Open Agent"
                  description="Full preset with opinionated defaults and the broadest orchestration surface."
                  selected={preferences?.variant === "openagent"}
                  badges={["Recommended", "Preset"]}
                  onClick={() => savePreferences({ variant: "openagent", customTemplate: null }, "variant")}
                />
                <VariantCard
                  title="Oh My OpenCode Slim"
                  description="Smaller preset for a leaner synced setup with fewer defaults."
                  selected={preferences?.variant === "slim"}
                  badges={["Preset"]}
                  onClick={() => savePreferences({ variant: "slim", customTemplate: null }, "variant")}
                />
                <VariantCard
                  title="Custom / No preset"
                  description="Start from a template and keep full manual control over plugins, models, and overrides."
                  selected={preferences?.variant === "custom"}
                  badges={["Manual control"]}
                  onClick={() => savePreferences({ variant: "custom", customTemplate: preferences?.customTemplate || "minimal" }, "variant")}
                />
              </div>

              {preferences?.variant === "custom" ? (
                <div className="max-w-sm">
                  <Select
                    label="Custom template"
                    value={preferences?.customTemplate || "minimal"}
                    onChange={(event) => savePreferences({ customTemplate: event.target.value }, "template")}
                    options={TEMPLATE_OPTIONS}
                    hint="Minimal keeps the template light; opinionated layers in more guided defaults."
                  />
                </div>
              ) : null}
            </div>
          </Card>

          <TokenManagerCard
            tokens={tokens}
            creating={tokenCreating}
            createError={tokenError}
            createdToken={createdToken}
            onCreate={createToken}
          />

          <ModelSelectionCard
            preferences={preferences}
            modelOptions={modelCatalog}
            saving={savingKey === "models"}
            error={error}
            onSave={(patch) => savePreferences(patch, "models")}
          />

          <PluginsCard
            preferences={preferences}
            saving={savingKey === "plugins"}
            error={error}
            onSave={(patch) => savePreferences(patch, "plugins")}
          />

          <McpServersCard
            key={JSON.stringify(preferences?.mcpServers || [])}
            preferences={preferences}
            saving={savingKey === "mcp servers"}
            error={error}
            onSave={(patch) => savePreferences(patch, "mcp servers")}
          />

          <EnvVarsCard
            key={JSON.stringify(preferences?.envVars || [])}
            preferences={preferences}
            saving={savingKey === "env vars"}
            error={error}
            onSave={(patch) => savePreferences(patch, "env vars")}
          />

          <AdvancedOverridesCard
            key={`${preferences?.variant || "openagent"}:${JSON.stringify(preferences?.advancedOverrides?.[preferences?.variant || "openagent"] || {})}`}
            preferences={preferences}
            saving={savingKey === "advanced overrides"}
            error={error}
            onSave={(patch) => savePreferences(patch, "advanced overrides")}
          />
        </div>

        <div className="space-y-6">
          <BundlePreviewCard preview={preview} loading={previewLoading} error={previewError} onRefresh={refreshPreview} />
        </div>
      </div>
    </div>
  );
}
