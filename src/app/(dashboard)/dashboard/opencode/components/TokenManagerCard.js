"use client";

import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/shared/components";

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
  const [name, setName] = useState("My Device");
  const [mode, setMode] = useState("device");

  return (
    <Card
      title="Connection & sync identity"
      subtitle="Generate per-device or shared tokens for local OpenCode plugin sync."
      icon="vpn_key"
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
          <Input
            label="Token name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="MacBook Pro"
          />
          <Select
            label="Mode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            options={[
              { value: "device", label: "Device" },
              { value: "shared", label: "Shared" },
            ]}
          />
          <div className="flex items-end">
            <Button
              fullWidth
              loading={creating}
              onClick={() => onCreate?.({ name, mode })}
              disabled={!name.trim()}
            >
              Create token
            </Button>
          </div>
        </div>

        {createError ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {createError}
          </div>
        ) : null}

        {createdToken ? (
          <Card.Section className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="success">New token</Badge>
              <span className="text-xs text-text-muted">Shown once — copy it now.</span>
            </div>
            <code className="block overflow-x-auto rounded-md bg-black px-3 py-2 text-xs text-slate-100">
              {createdToken}
            </code>
          </Card.Section>
        ) : null}

        <div className="space-y-3">
          {tokens.length === 0 ? (
            <p className="text-sm text-text-muted">No sync tokens created yet.</p>
          ) : (
            tokens.map((token) => (
              <Card.Section key={token.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-text-main">{token.name}</div>
                    <div className="text-xs text-text-muted">Created {formatDate(token.createdAt)}</div>
                  </div>
                  <Badge variant={token.mode === "shared" ? "info" : "primary"}>
                    {token.mode}
                  </Badge>
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
