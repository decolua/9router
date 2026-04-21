"use client";

import { useState } from "react";
import { Button, Card, Input, Select } from "@/shared/components";

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
      subtitle="Attach local command-based or remote MCP endpoints to the generated bundle."
      icon="dns"
      action={
        <Button variant="secondary" size="sm" onClick={saveServers} loading={saving}>
          Save MCP servers
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
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

        <div className="flex justify-end">
          <Button onClick={addServer} loading={saving}>
            Add MCP server
          </Button>
        </div>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {localError ? <p className="text-sm text-red-600 dark:text-red-400">{localError}</p> : null}

        <div className="space-y-3">
          {draftServers.length === 0 ? (
            <p className="text-sm text-text-muted">No MCP servers configured.</p>
          ) : (
            draftServers.map((draftServer, index) => {

              return (
                <Card.Section key={`${draftServer.name || "server"}-${index}`} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text-main">{draftServer.name || `Server ${index + 1}`}</div>
                      <div className="text-xs text-text-muted">{draftServer.type === "remote" ? "Remote URL" : "Local command"}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDraftServer(index)}
                    >
                      Remove
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
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
