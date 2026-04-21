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
      title="Custom plugins"
      subtitle="Add extra plugin packages on top of the selected preset."
      icon="extension"
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
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

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {plugins.length === 0 ? (
            <p className="text-sm text-text-muted">No custom plugins added.</p>
          ) : (
            plugins.map((item) => (
              <Badge key={item} className="gap-2 pr-1">
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
    </Card>
  );
}
