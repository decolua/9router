"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/shared/components/Button";
import { ConfirmModal } from "@/shared/components/Modal";

const SERVER_TYPES = [
  { id: "remote-http", label: "Remote (HTTP)", icon: "cloud", description: "Streamable HTTP transport — sends JSON-RPC via POST" },
  { id: "remote-sse", label: "Remote (SSE)", icon: "cell_tower", description: "Server-Sent Events transport — subscribes to SSE stream" },
  { id: "local-stdio", label: "Local (stdio)", icon: "terminal", description: "Spawns a local process and communicates via stdin/stdout" },
];

const PRESET_SERVERS = [
  { name: "Exa Search", type: "remote-http", url: "https://mcp.exa.ai/mcp", description: "Real-time web search and code documentation", toolNames: ["web_search_exa", "web_fetch_exa"] },
  { name: "Tavily", type: "remote-http", url: "https://mcp.tavily.com/mcp", description: "Real-time web search optimized for LLM agents", headers: { "Authorization": "Bearer " }, toolNames: ["tavily_search", "tavily_extract"] },
  { name: "Google Stitch", type: "remote-http", url: "https://stitch.googleapis.com/mcp", description: "Generate UI screens and manage design systems with Google Stitch", headers: { "X-Goog-Api-Key": "" }, toolNames: ["list_projects", "list_screens", "get_project", "get_screen", "create_project", "generate_screen_from_text", "edit_screens", "generate_variants", "create_design_system", "update_design_system", "apply_design_system", "upload_design_md", "create_design_system_from_design_md", "list_design_systems"] },
  { name: "Astro Docs", type: "remote-http", url: "https://mcp.docs.astro.build/mcp", description: "Astro documentation and resources search" },
  { name: "Firecrawl", type: "local-stdio", command: "npx", args: ["-y", "firecrawl-mcp"], env: { "FIRECRAWL_API_KEY": "" }, description: "Convert websites into LLM-ready markdown or structured data" },
  { name: "Git", type: "local-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-git"], description: "Run git commands, inspect repository history, diffs, and staging" },
  { name: "Puppeteer", type: "local-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"], description: "Web scraping and browser automation using headless Chrome" },
  { name: "PostgreSQL", type: "local-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], description: "Inspect and query PostgreSQL databases" },
  { name: "Memory", type: "local-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], description: "Graph-based knowledge representation and semantic memory" },
  { name: "Filesystem", type: "local-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], description: "Read/write files on local filesystem" },
  { name: "GitHub", type: "local-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], description: "GitHub API integration" },
  { name: "Browser MCP", type: "local-stdio", command: "npx", args: ["-y", "@browsermcp/mcp@latest"], description: "Control your running Chrome browser" },
];

export default function McpServersPageClient() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [expandedServer, setExpandedServer] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-servers");
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers || []);
      }
    } catch { } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const handleTest = async (server) => {
    setTestingId(server.id);
    setTestResults((prev) => ({ ...prev, [server.id]: null }));
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}/test`, { method: "POST" });
      const result = await res.json();
      setTestResults((prev) => ({ ...prev, [server.id]: result }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [server.id]: { ok: false, error: err.message } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (server) => {
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}`, { method: "DELETE" });
      if (res.ok) {
        setServers((prev) => prev.filter((s) => s.id !== server.id));
        setDeleteTarget(null);
      }
    } catch { }
  };

  const handleToggleActive = async (server) => {
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !server.isActive }),
      });
      if (res.ok) {
        setServers((prev) =>
          prev.map((s) => (s.id === server.id ? { ...s, isActive: !s.isActive } : s))
        );
      }
    } catch { }
  };

  const handleAddServer = async (formData) => {
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        const data = await res.json();
        setServers((prev) => [...prev, data.server]);
        setShowAddModal(false);
      }
    } catch { }
  };

  const handleUpdateServer = async (formData) => {
    if (!editingServer) return;
    try {
      const res = await fetch(`/api/mcp-servers/${editingServer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        const data = await res.json();
        setServers((prev) => prev.map((s) => (s.id === editingServer.id ? data.server : s)));
        setEditingServer(null);
      }
    } catch { }
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-primary">hub</span>
            MCP Servers
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Configure MCP servers to add tools and capabilities to your AI agents
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon="auto_awesome" onClick={() => setShowPresetModal(true)}>
            Presets
          </Button>
          <Button variant="primary" size="sm" icon="add" onClick={() => setShowAddModal(true)}>
            Add Server
          </Button>
        </div>
      </div>

      {/* Gateway Info */}
      <div className="rounded-xl bg-surface-1 border border-border-subtle p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center size-9 rounded-lg bg-brand-500/10 shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-[18px] text-brand-500">swap_horiz</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-text-main">Unified Gateway Endpoint</h3>
            <p className="text-xs text-text-muted mt-0.5">
              All active servers are accessible through a single gateway. Configure your MCP client to use:
            </p>
            <code className="block mt-2 px-3 py-1.5 rounded-lg bg-surface-2 text-xs font-mono text-brand-400 break-all">
              {mounted ? `${window.location.origin}/api/mcp-gateway` : "/api/mcp-gateway"}
            </code>
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">cell_tower</span>
                SSE: <code className="text-brand-400">/sse</code>
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">send</span>
                Message: <code className="text-brand-400">/message</code>
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">select_all</span>
                Per-server: <code className="text-brand-400">/[serverId]/...</code>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Server List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="material-symbols-outlined animate-spin text-2xl text-text-muted">progress_activity</span>
        </div>
      ) : servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-surface-1 border border-border-subtle border-dashed">
          <div className="flex items-center justify-center size-14 rounded-full bg-surface-2 mb-4">
            <span className="material-symbols-outlined text-2xl text-text-muted">hub</span>
          </div>
          <h3 className="text-base font-medium text-text-main mb-1">No MCP servers configured</h3>
          <p className="text-sm text-text-muted mb-4 text-center max-w-md">
            Add MCP servers to give your AI agents access to tools like web search, file system, GitHub, and more.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon="auto_awesome" onClick={() => setShowPresetModal(true)}>
              Browse Presets
            </Button>
            <Button variant="primary" size="sm" icon="add" onClick={() => setShowAddModal(true)}>
              Add Server
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              isExpanded={expandedServer === server.id}
              onToggleExpand={() => setExpandedServer(expandedServer === server.id ? null : server.id)}
              testingId={testingId}
              testResult={testResults[server.id]}
              onTest={handleTest}
              onToggleActive={handleToggleActive}
              onEdit={() => setEditingServer(server)}
              onDelete={() => setDeleteTarget(server)}
            />
          ))}
        </div>
      )}

      {/* Add Server Modal */}
      {showAddModal && (
        <ServerFormModal
          title="Add MCP Server"
          onSubmit={handleAddServer}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Preset Modal */}
      {showPresetModal && (
        <PresetModal
          onSelect={(preset) => {
            setShowPresetModal(false);
            handleAddServer(preset);
          }}
          onClose={() => setShowPresetModal(false)}
        />
      )}

      {/* Edit Modal */}
      {editingServer && (
        <ServerFormModal
          title="Edit MCP Server"
          server={editingServer}
          onSubmit={handleUpdateServer}
          onClose={() => setEditingServer(null)}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title="Delete MCP Server"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}

// ─── Server Card ───────────────────────────────────────────────────────────

function ServerCard({ server, isExpanded, onToggleExpand, testingId, testResult, onTest, onToggleActive, onEdit, onDelete }) {
  const typeInfo = SERVER_TYPES.find((t) => t.id === server.type) || SERVER_TYPES[0];
  const isTesting = testingId === server.id;

  return (
    <div className={`rounded-xl border transition-all duration-200 ${server.isActive ? "bg-surface-1 border-border-subtle hover:border-border" : "bg-surface-1/50 border-border-subtle/50 opacity-60"}`}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle */}
        <button
          onClick={() => onToggleActive()}
          className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${server.isActive ? "bg-brand-500" : "bg-surface-3"}`}
        >
          <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${server.isActive ? "translate-x-5" : ""}`} />
        </button>

        {/* Icon + Name */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`flex items-center justify-center size-9 rounded-lg shrink-0 ${server.isActive ? "bg-brand-500/10" : "bg-surface-2"}`}>
            <span className={`material-symbols-outlined text-[18px] ${server.isActive ? "text-brand-500" : "text-text-muted"}`}>{typeInfo.icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-main truncate">{server.name}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted shrink-0">{typeInfo.label}</span>
              {testResult && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${testResult.ok ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                  {testResult.ok ? "Connected" : "Failed"}
                </span>
              )}
            </div>
            {server.description && (
              <p className="text-xs text-text-muted truncate mt-0.5">{server.description}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onTest(server)}
            disabled={isTesting}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-brand-500 transition-colors cursor-pointer disabled:opacity-50"
            title="Test connection"
          >
            <span className={`material-symbols-outlined text-[16px] ${isTesting ? "animate-spin" : ""}`}>
              {isTesting ? "progress_activity" : "play_arrow"}
            </span>
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="Edit"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors cursor-pointer"
            title="Delete"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
          <button
            onClick={onToggleExpand}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-main transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px] transition-transform" style={{ transform: isExpanded ? "rotate(180deg)" : "" }}>
              expand_more
            </span>
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 border-t border-border-subtle/50">
          <div className="grid gap-2 text-xs">
            {server.url && (
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-16 shrink-0">URL</span>
                <code className="text-text-main font-mono truncate break-all">{server.url}</code>
              </div>
            )}
            {server.command && (
              <div className="flex items-center gap-2">
                <span className="text-text-muted w-16 shrink-0">Command</span>
                <code className="text-text-main font-mono">{server.command} {(server.args || []).join(" ")}</code>
              </div>
            )}
            {server.toolNames?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-text-muted w-16 shrink-0">Tools</span>
                <div className="flex flex-wrap gap-1">
                  {server.toolNames.map((tool) => (
                    <span key={tool} className="px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">{tool}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-16 shrink-0">Endpoint</span>
              <code className="text-brand-400 font-mono">
                /api/mcp-gateway/{server.id}
              </code>
            </div>
          </div>
          {testResult && (
            <div className={`mt-2 px-3 py-2 rounded-lg border ${testResult.ok ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"}`}>
              {testResult.ok ? (
                <div>
                  <p className="text-xs text-green-500 font-medium mb-1">
                    ✓ Connected — {testResult.toolCount ?? 0} tool{testResult.toolCount !== 1 ? "s" : ""} available
                  </p>
                  {testResult.serverInfo && (
                    <p className="text-[10px] text-text-muted">{testResult.serverInfo.name} v{testResult.serverInfo.version}</p>
                  )}
                  {testResult.tools?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {testResult.tools.map((tool) => (
                        <span key={tool} className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 text-[10px]">{tool}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-red-500">{testResult.error}</p>
                  {testResult.hint && <p className="text-[10px] text-red-400/70 mt-1">{testResult.hint}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Server Form Modal ─────────────────────────────────────────────────────

function ServerFormModal({ title, server, onSubmit, onClose }) {
  const [name, setName] = useState(server?.name || "");
  const [type, setType] = useState(server?.type || "remote-http");
  const [url, setUrl] = useState(server?.url || "");
  const [command, setCommand] = useState(server?.command || "");
  const [argsStr, setArgsStr] = useState((server?.args || []).join(" "));
  const [description, setDescription] = useState(server?.description || "");
  const [headersStr, setHeadersStr] = useState(server?.headers ? JSON.stringify(server.headers, null, 2) : "");
  const [toolNamesStr, setToolNamesStr] = useState((server?.toolNames || []).join(", "));
  const [envStr, setEnvStr] = useState(server?.env ? JSON.stringify(server.env, null, 2) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isRemote = type === "remote-http" || type === "remote-sse";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const data = { name, type };
      if (isRemote) data.url = url;
      if (type === "local-stdio") {
        data.command = command;
        data.args = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
        if (envStr.trim()) {
          try { data.env = JSON.parse(envStr); } catch { setError("Invalid JSON in environment variables"); setSaving(false); return; }
        }
      }
      if (description) data.description = description;
      if (headersStr.trim()) {
        try { data.headers = JSON.parse(headersStr); } catch { setError("Invalid JSON in headers"); setSaving(false); return; }
      }
      if (toolNamesStr.trim()) {
        data.toolNames = toolNamesStr.split(",").map((s) => s.trim()).filter(Boolean);
      }
      await onSubmit(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-surface-1 border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text-main">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-2 text-text-muted transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP Server"
              required
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Transport Type</label>
            <div className="grid grid-cols-3 gap-2">
              {SERVER_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all cursor-pointer ${type === t.id
                      ? "border-brand-500 bg-brand-500/10 text-brand-500"
                      : "border-border bg-surface-2 text-text-muted hover:border-border hover:text-text-main"
                    }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
                  <span className="text-[11px] font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* URL (for remote) */}
          {isRemote && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Server URL *</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                required
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          )}

          {/* Command (for stdio) */}
          {type === "local-stdio" && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Command *</label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Arguments (space-separated)</label>
                <input
                  type="text"
                  value={argsStr}
                  onChange={(e) => setArgsStr(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">Environment Variables (JSON)</label>
                <textarea
                  value={envStr}
                  onChange={(e) => setEnvStr(e.target.value)}
                  placeholder='{"API_KEY": "sk-...", "DEBUG": "true"}'
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors resize-none"
                />
              </div>
            </>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this server provides..."
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Tool Names */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Tool Names (comma-separated)</label>
            <input
              type="text"
              value={toolNamesStr}
              onChange={(e) => setToolNamesStr(e.target.value)}
              placeholder="web_search, file_read, execute_command"
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          {/* Custom Headers (JSON) */}
          {isRemote && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Custom Headers (JSON)</label>
              <textarea
                value={headersStr}
                onChange={(e) => setHeadersStr(e.target.value)}
                placeholder='{"Authorization": "Bearer ..."}'
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-xs text-text-main font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-brand-500 transition-colors resize-none"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" type="submit" loading={saving} icon="save">
              {server ? "Update" : "Add Server"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Preset Modal ──────────────────────────────────────────────────────────

function PresetModal({ onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-surface-1 border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-text-main">Add from Preset</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-2 text-text-muted transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-4 grid gap-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {PRESET_SERVERS.map((preset) => {
            const typeInfo = SERVER_TYPES.find((t) => t.id === preset.type) || SERVER_TYPES[0];
            return (
              <button
                key={preset.name}
                onClick={() => onSelect(preset)}
                className="flex items-center w-full min-w-0 gap-3 p-3 rounded-xl bg-surface-2 hover:bg-surface-3 border border-transparent hover:border-border-subtle transition-all cursor-pointer text-left"
              >
                <div className="flex items-center justify-center size-9 rounded-lg bg-brand-500/10 shrink-0">
                  <span className="material-symbols-outlined text-[18px] text-brand-500">{typeInfo.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-text-main">{preset.name}</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-1 text-text-muted">{typeInfo.label}</span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 truncate">{preset.description}</p>
                </div>
                <span className="material-symbols-outlined text-[16px] text-text-muted">add_circle</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
