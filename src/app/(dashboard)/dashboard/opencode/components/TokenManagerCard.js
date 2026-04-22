"use client";

import { useState } from "react";
import { Badge, Button, Card, Input } from "@/shared/components";

function formatDate(value) {
  if (!value) return "Never";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function TokenManagerCard({
  tokens = [],
  creating = false,
  createError = "",
  createdToken = "",
  onCreate,
}) {
  const [name, setName] = useState("My Token");
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <Card
      title="Auto-sync tokens"
      subtitle="Create tokens to enable automatic config sync from this dashboard."
      icon="vpn_key"
      className="rounded-[24px] border-black/5 shadow-[0_16px_42px_rgba(0,0,0,0.04)] dark:border-white/5"
    >
      <div className="space-y-6">
        <div className="rounded-[24px] border border-primary/10 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent px-5 py-[1.125rem]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-main">Create a sync token</p>
              <p className="text-xs leading-5 text-text-muted">Tokens allow OpenCode to sync config from this dashboard automatically.</p>
            </div>
            <Badge size="sm">{tokens.length} active</Badge>
          </div>
        </div>

        <Card.Section className="rounded-[24px] border border-black/5 bg-white/[0.78] px-5 py-5 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="mb-4 space-y-1">
            <p className="text-sm font-semibold text-text-main">Issue a new token</p>
            <p className="text-xs leading-5 text-text-muted">New token values are only shown once, so create them only when you are ready to copy.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Input
              label="Token name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Production Server"
              hint="Give it a descriptive name to identify where it's used."
            />
            <div className="flex items-end">
              <Button
                fullWidth
                loading={creating}
                onClick={() => onCreate?.({ name, mode: "shared" })}
                disabled={!name.trim()}
              >
                Create token
              </Button>
            </div>
          </div>
        </Card.Section>

        {createError ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {createError}
          </div>
        ) : null}

        {createdToken ? (
          <div className="space-y-4">
            <Card.Section className="space-y-3 rounded-[24px] border border-emerald-500/20 bg-emerald-500/[0.06] px-5 py-[1.125rem]">
              <div className="flex items-center gap-2">
                <Badge variant="success">New token</Badge>
                <span className="text-xs text-text-muted">Shown once — copy it now.</span>
              </div>
              <code className="block overflow-x-auto rounded-md bg-black px-3 py-2 text-xs text-slate-100">
                {createdToken}
              </code>
              <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                ⚠️ This token will not be shown again. Save it securely before closing this message.
              </div>
            </Card.Section>

            {/* Setup Instructions */}
            <Card.Section className="space-y-3 rounded-[24px] border border-blue-500/20 bg-blue-500/[0.06] px-5 py-[1.125rem]">
              <button
                type="button"
                onClick={() => setShowInstructions(!showInstructions)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                  📋 Setup Instructions
                </span>
                <span className="text-blue-700 dark:text-blue-400">
                  {showInstructions ? "▼" : "▶"}
                </span>
              </button>

              {showInstructions && (
                <div className="space-y-4 pt-2 text-xs text-blue-900 dark:text-blue-300">
                  <div>
                    <p className="font-semibold mb-2">1. Add to opencode.json plugin array:</p>
                    <code className="block rounded-md bg-black px-3 py-2 text-xs text-slate-100 overflow-x-auto">
                      "plugin": ["opencode-9router-sync@latest", ...]
                    </code>
                  </div>

                  <div>
                    <p className="font-semibold mb-2">2. Create config file:</p>
                    
                    {/* Standard */}
                    <div className="mb-3 rounded-md border border-gray-500/20 bg-gray-500/10 p-3">
                      <p className="font-semibold mb-1 text-gray-700 dark:text-gray-300">Standard:</p>
                      <code className="block text-[10px] text-gray-600 dark:text-gray-400 mb-2">
                        ~/.config/opencode-9router-sync/config.json
                      </code>
                      <pre className="rounded-md bg-black px-3 py-2 text-[10px] text-slate-100 overflow-x-auto">
{`{
  "dashboardUrl": "${typeof window !== "undefined" ? window.location.origin : "http://localhost:20129"}",
  "syncToken": "${createdToken}",
  "lastKnownVersion": null
}`}
                      </pre>
                    </div>

                    {/* OCX Profile */}
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <p className="font-semibold mb-1 text-emerald-700 dark:text-emerald-400">With OCX Profile:</p>
                      <code className="block text-[10px] text-emerald-600 dark:text-emerald-400 mb-2">
                        ~/.config/opencode/profiles/&lt;profilename&gt;/opencode-9router-sync/config.json
                      </code>
                      <pre className="rounded-md bg-black px-3 py-2 text-[10px] text-slate-100 overflow-x-auto">
{`{
  "dashboardUrl": "${typeof window !== "undefined" ? window.location.origin : "http://localhost:20129"}",
  "syncToken": "${createdToken}",
  "lastKnownVersion": null
}`}
                      </pre>
                    </div>
                  </div>

                  <div className="rounded-md border border-blue-500/20 bg-blue-500/10 px-3 py-2">
                    <p className="text-blue-700 dark:text-blue-300">
                      ✨ <strong>Auto-sync:</strong> The plugin will automatically sync your config from 9Router dashboard on OpenCode startup.
                    </p>
                  </div>
                </div>
              )}
            </Card.Section>
          </div>
        ) : null}

        <div className="space-y-4">
          {tokens.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-black/8 bg-black/[0.015] px-5 py-6 text-sm text-text-muted dark:border-white/10 dark:bg-white/[0.015]">
              No auto-sync tokens created yet.
            </div>
          ) : (
            tokens.map((token) => (
              <Card.Section key={token.id} className="space-y-4 rounded-[24px] border border-black/5 bg-white/[0.75] px-5 py-5 dark:border-white/5 dark:bg-white/[0.02]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-text-main">{token.name}</div>
                    <div className="mt-1 text-xs text-text-muted">Created {formatDate(token.createdAt)}</div>
                  </div>
                </div>
                {token.metadata && Object.keys(token.metadata).length > 0 ? (
                  <pre className="overflow-x-auto rounded-md bg-black/[0.03] px-3 py-2 text-xs text-text-muted dark:bg-white/[0.03]">
                    {JSON.stringify(token.metadata, null, 2)}
                  </pre>
                ) : null}
                <div className="text-xs text-text-muted">Last used: {formatDate(token.lastUsedAt)}</div>
              </Card.Section>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
