"use client";

import { useState } from "react";
import { Badge, Button, Card, Input } from "@/shared/components";

export default function PluginsCard({ preferences, saving = false, error = "", onSave }) {
  const [plugin, setPlugin] = useState("");
  const plugins = preferences?.customPlugins || [];

  const addPlugin = () => {
    const nextPlugin = plugin.trim();
    if (!nextPlugin || plugins.includes(nextPlugin)) return;

    onSave?.({ customPlugins: [...plugins, nextPlugin] });
    setPlugin("");
  };

  return (
    <Card
      title="Plugins"
      subtitle="Optional: add or remove plugin packages if you want to customize beyond the default generated setup."
      icon="extension"
      className="rounded-[24px] border-black/5 shadow-[0_16px_40px_rgba(0,0,0,0.04)] dark:border-white/5"
    >
      <div className="space-y-6">
        <div className="rounded-[24px] border border-primary/10 bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent px-5 py-[1.125rem]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-main">Plugin packages</p>
              <p className="text-xs leading-5 text-text-muted">Add only the extras you actually need so the generated setup stays lean.</p>
            </div>
            <Badge size="sm">{plugins.length} added</Badge>
          </div>
        </div>

        <Card.Section className="rounded-[24px] border border-black/5 bg-white/[0.78] px-5 py-5 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="mb-4 space-y-1">
            <p className="text-sm font-semibold text-text-main">Add a package</p>
            <p className="text-xs leading-5 text-text-muted">Keep plugin additions sparse so the generated setup stays readable.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Input
              label="Plugin package"
              value={plugin}
              onChange={(event) => setPlugin(event.target.value)}
              placeholder="my-plugin@latest"
              hint="Use npm-style package names with optional tags or versions."
            />
            <div className="flex items-end">
              <Button onClick={addPlugin} disabled={!plugin.trim()} loading={saving}>
                Add plugin
              </Button>
            </div>
          </div>
        </Card.Section>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="rounded-[22px] border border-dashed border-black/8 bg-black/[0.015] p-4 dark:border-white/10 dark:bg-white/[0.015]">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-text-main">Current plugin list</p>
            {plugins.length > 0 ? <Badge size="sm">Editable</Badge> : null}
          </div>
          <div className="flex min-h-[40px] flex-wrap gap-2.5">
            {plugins.length === 0 ? (
              <p className="text-sm text-text-muted">No custom plugins added.</p>
            ) : (
              plugins.map((item) => (
                <Badge key={item} className="gap-2 pr-1 shadow-sm">
                  <span>{item}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                    onClick={() => onSave?.({ customPlugins: plugins.filter((pluginId) => pluginId !== item) })}
                    aria-label={`Remove ${item}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </Badge>
              ))
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
