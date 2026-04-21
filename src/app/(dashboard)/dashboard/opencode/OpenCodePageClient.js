"use client";

import { useEffect, useState } from "react";
import { Card, CardSkeleton } from "@/shared/components";

function JsonPreview({ data }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-black/5 bg-black px-4 py-3 text-xs leading-6 text-slate-100 dark:border-white/5">
      <code>{JSON.stringify(data, null, 2)}</code>
    </pre>
  );
}

export default function OpenCodePageClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const [preferencesRes, previewRes] = await Promise.all([
          fetch("/api/opencode/preferences"),
          fetch("/api/opencode/bundle/preview"),
        ]);

        const [preferencesData, previewData] = await Promise.all([
          preferencesRes.json(),
          previewRes.json(),
        ]);

        if (!preferencesRes.ok) {
          throw new Error(preferencesData?.error || "Failed to load OpenCode preferences");
        }

        if (!previewRes.ok) {
          throw new Error(previewData?.error || "Failed to load OpenCode bundle preview");
        }

        if (cancelled) return;

        setPreferences(preferencesData.preferences || null);
        setPreview(previewData);
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
        subtitle="Stage VPS-backed sync settings, then preview the local plugin bundle before Task 7 adds the full builder workflow."
        icon="extension"
      >
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card
          title="Current preferences"
          subtitle="Sanitized dashboard view of the persisted OpenCode configuration"
          icon="tune"
        >
          {preferences ? (
            <JsonPreview data={preferences} />
          ) : (
            <p className="text-sm text-text-muted">No OpenCode preferences are available yet.</p>
          )}
        </Card>

        <Card
          title="Bundle preview"
          subtitle="Initial JSON surface for the generated sync plugin payload"
          icon="data_object"
        >
          {preview ? (
            <JsonPreview data={preview} />
          ) : (
            <p className="text-sm text-text-muted">No preview payload was returned.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
