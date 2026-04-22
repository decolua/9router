"use client";

import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/shared/components";

function createEmptyServer() {
  return {
    name: "",
    type: "local",
    command: "",
    args: "",
    url: "",
  };
}

function toStoredServer(draft) {
  if (draft.type === "remote") {
    return {
      name: draft.name.trim(),
      type: "remote",
      url: draft.url.trim(),
    };
  }

  return {
    name: draft.name.trim(),
    type: "local",
    command: [draft.command.trim(), ...draft.args.split(",").map((item) => item.trim()).filter(Boolean)].filter(Boolean),
  };
}

function fromStoredServer(server) {
  const command = Array.isArray(server?.command) ? server.command : [];
  return {
    name: server?.name || "",
    type: server?.type === "remote" ? "remote" : "local",
    command: command[0] || "",
    args: command.slice(1).join(", "),
    url: server?.url || "",
  };
}

export default function McpServersCard({ preferences, saving = false, error = "", onSave }) {
  const [draft, setDraft] = useState(createEmptyServer());
  const [draftServers, setDraftServers] = useState(() =>
    (preferences?.mcpServers || []).map((server) => fromStoredServer(server))
  );
  const [localError, setLocalError] = useState("");

  const validateServer = (server) => {
    if (!server?.name?.trim()) return "Server name is required";
    if (server.type === "remote" && !server.url?.trim()) return `Remote MCP server "${server.name.trim()}" requires a URL`;
    if (server.type !== "remote" && !server.command?.trim()) return `Local MCP server "${server.name.trim()}" requires a command`;
    return "";
  };

  const addServer = () => {
    const validationError = validateServer(draft);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    setDraftServers((current) => [...current, draft]);
    setDraft(createEmptyServer());
    setLocalError("");
  };

  const updateDraftServer = (index, patch) => {
    setDraftServers((current) =>
      current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item))
    );
  };

  const removeDraftServer = (index) => {
    setDraftServers((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const saveServers = () => {
    const firstInvalid = draftServers.find((server) => validateServer(server));
    if (firstInvalid) {
      setLocalError(validateServer(firstInvalid));
      return;
    }

    setLocalError("");

    onSave?.({
      mcpServers: draftServers
        .filter((server) => server.name.trim())
        .map((server) => toStoredServer(server)),
    });
  };

  return (
    <Card
      title="MCP servers"
      subtitle="Optional: attach local command-based or remote MCP servers so they appear in the generated config when you need them."
      icon="dns"
      className="rounded-[24px] border-black/5 shadow-[0_16px_42px_rgba(0,0,0,0.04)] dark:border-white/5"
      action={
        <Button variant="secondary" size="sm" onClick={saveServers} loading={saving}>
          Save MCP servers
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="rounded-[24px] border border-primary/10 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent px-5 py-[1.125rem]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-main">Connected MCP endpoints</p>
              <p className="text-xs leading-5 text-text-muted">Mix local command runners and remote URLs without overcrowding the main setup flow.</p>
            </div>
            <Badge size="sm">{draftServers.length} configured</Badge>
          </div>
        </div>

        <Card.Section className="rounded-[24px] border border-black/5 bg-white/[0.78] px-5 py-5 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text-main">Add a server</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">Create the next MCP entry, then save the whole list once it feels complete.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Server name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="filesystem"
            />
            <Select
              label="Type"
              value={draft.type}
              onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
              options={[
                { value: "local", label: "Local command" },
                { value: "remote", label: "Remote URL" },
              ]}
            />
            {draft.type === "remote" ? (
              <Input
                label="Remote URL"
                value={draft.url}
                onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://example.com/mcp"
                className="md:col-span-2"
              />
            ) : (
              <>
                <Input
                  label="Command"
                  value={draft.command}
                  onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
                  placeholder="npx"
                />
                <Input
                  label="Args"
                  value={draft.args}
                  onChange={(event) => setDraft((current) => ({ ...current, args: event.target.value }))}
                  placeholder="@modelcontextprotocol/server-filesystem, /workspace"
                  hint="Comma-separated for a small inline editor."
                />
              </>
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={addServer} loading={saving}>
              Add MCP server
            </Button>
          </div>
        </Card.Section>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {localError ? <p className="text-sm text-red-600 dark:text-red-400">{localError}</p> : null}

        <div className="space-y-4">
          {draftServers.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-black/8 bg-black/[0.015] px-5 py-6 text-sm text-text-muted dark:border-white/10 dark:bg-white/[0.015]">No MCP servers configured yet.</div>
          ) : (
            draftServers.map((draftServer, index) => {

              return (
                <Card.Section key={`${draftServer.name || "server"}-${index}`} className="space-y-5 rounded-[24px] border border-black/5 bg-white/[0.75] px-5 py-5 dark:border-white/5 dark:bg-white/[0.02]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text-main">{draftServer.name || `Server ${index + 1}`}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <span>{draftServer.type === "remote" ? "Remote URL" : "Local command"}</span>
                        <span className="inline-block h-1 w-1 rounded-full bg-text-muted/50" />
                        <span>{draftServer.type === "remote" ? "Network-based" : "Runs locally"}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDraftServer(index)}
                    >
                      Remove
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Input
                      label="Name"
                      value={draftServer.name}
                      onChange={(event) => updateDraftServer(index, { name: event.target.value })}
                    />
                    <Select
                      label="Type"
                      value={draftServer.type}
                      onChange={(event) => updateDraftServer(index, { type: event.target.value })}
                      options={[
                        { value: "local", label: "Local command" },
                        { value: "remote", label: "Remote URL" },
                      ]}
                    />
                    {draftServer.type === "remote" ? (
                      <Input
                        label="URL"
                        value={draftServer.url}
                        onChange={(event) => updateDraftServer(index, { url: event.target.value })}
                        className="md:col-span-2"
                      />
                    ) : (
                      <>
                        <Input
                          label="Command"
                          value={draftServer.command}
                          onChange={(event) => updateDraftServer(index, { command: event.target.value })}
                        />
                        <Input
                          label="Args"
                          value={draftServer.args}
                          onChange={(event) => updateDraftServer(index, { args: event.target.value })}
                        />
                      </>
                    )}
                  </div>
                </Card.Section>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}
