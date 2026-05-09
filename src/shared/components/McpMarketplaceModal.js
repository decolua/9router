"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";

const REGISTRY_ENDPOINT = "/api/cli-tools/cowork-mcp-registry";
const TOOLS_ENDPOINT = "/api/cli-tools/cowork-mcp-tools";

export default function McpMarketplaceModal({ isOpen, onClose, onAdd, addedNames = [] }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState(null);
  const [expandedUrl, setExpandedUrl] = useState(null);
  const [toolsCache, setToolsCache] = useState({});
  const [toolsLoading, setToolsLoading] = useState({});
  const [toolSelection, setToolSelection] = useState({});

  useEffect(() => {
    if (!isOpen) return;
    if (servers.length > 0) return;
    setLoading(true);
    fetch(REGISTRY_ENDPOINT)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setServers(d.servers || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const addedSet = useMemo(() => new Set(addedNames), [addedNames]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servers.filter((s) => {
      if (filter === "authless" && s.oauth) return false;
      if (filter === "oauth" && !s.oauth) return false;
      if (!q) return true;
      return (
        (s.title || "").toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q) ||
        (s.name || "").toLowerCase().includes(q)
      );
    });
  }, [servers, search, filter]);

  const fetchTools = async (server) => {
    if (toolsCache[server.url]) return;
    setToolsLoading((p) => ({ ...p, [server.url]: true }));
    try {
      const r = await fetch(TOOLS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: server.url }),
      });
      const d = await r.json();
      const tools = d.tools || [];
      const fallback = Array.isArray(server.toolNames) ? server.toolNames : [];
      const toolNames = tools.length > 0 ? tools.map((t) => t.name) : fallback;
      setToolsCache((p) => ({ ...p, [server.url]: { tools, requiresAuth: !!d.requiresAuth, error: d.error } }));
      // Default: all checked
      setToolSelection((p) => ({ ...p, [server.url]: Object.fromEntries(toolNames.map((t) => [t, true])) }));
    } catch (e) {
      setToolsCache((p) => ({ ...p, [server.url]: { tools: [], error: e.message } }));
    } finally {
      setToolsLoading((p) => ({ ...p, [server.url]: false }));
    }
  };

  const expandServer = (server) => {
    if (expandedUrl === server.url) {
      setExpandedUrl(null);
      return;
    }
    setExpandedUrl(server.url);
    fetchTools(server);
  };

  const toggleTool = (url, tool) => {
    setToolSelection((prev) => ({ ...prev, [url]: { ...prev[url], [tool]: !prev[url]?.[tool] } }));
  };

  const setAllTools = (url, value) => {
    const sel = toolSelection[url] || {};
    setToolSelection((prev) => ({ ...prev, [url]: Object.fromEntries(Object.keys(sel).map((t) => [t, value])) }));
  };

  const confirmAdd = (server) => {
    const sel = toolSelection[server.url] || {};
    const enabled = Object.keys(sel).filter((t) => sel[t]);
    onAdd?.({
      name: server.slug || server.name,
      title: server.title,
      description: server.description,
      url: server.url,
      transport: server.transport,
      oauth: server.oauth,
      toolNames: enabled,
    });
    setExpandedUrl(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Browse MCP Marketplace" size="lg">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or description..."
            className="flex-1 px-2 py-1.5 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-2 py-1.5 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="all">All</option>
            <option value="authless">Authless</option>
            <option value="oauth">OAuth</option>
          </select>
        </div>

        {error && (
          <div className="px-2 py-1.5 rounded text-xs bg-red-500/10 text-red-600">{error}</div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-text-muted text-xs py-4 justify-center">
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            <span>Loading registry...</span>
          </div>
        )}

        {!loading && (
          <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-center text-xs text-text-muted py-6">No servers match filter</div>
            )}
            {filtered.map((s) => {
              const added = addedSet.has(s.slug || s.name);
              const expanded = expandedUrl === s.url;
              const cache = toolsCache[s.url];
              const isLoadingTools = toolsLoading[s.url];
              const sel = toolSelection[s.url] || {};
              const toolKeys = Object.keys(sel);
              const selectedCount = Object.values(sel).filter(Boolean).length;
              return (
                <div key={s.url} className="rounded border border-transparent hover:border-border">
                  <div className="flex items-start gap-2 px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5">
                    {s.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.iconUrl} alt="" className="size-7 rounded shrink-0 object-contain" onError={(e) => { e.target.style.display = "none"; }} />
                    ) : (
                      <div className="size-7 rounded bg-surface shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-xs">{s.title}</span>
                        {s.oauth ? (
                          <span className="px-1 py-0.5 text-[9px] rounded bg-amber-500/10 text-amber-600">OAuth</span>
                        ) : (
                          <span className="px-1 py-0.5 text-[9px] rounded bg-green-500/10 text-green-600">Authless</span>
                        )}
                        {s.toolCount > 0 && (
                          <span className="text-[10px] text-text-muted">{s.toolCount} tools</span>
                        )}
                      </div>
                      {s.description && (
                        <p className="text-[10px] text-text-muted line-clamp-2 mt-0.5">{s.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => added ? null : expandServer(s)}
                      disabled={added}
                      className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        added
                          ? "bg-green-500/10 text-green-600 cursor-default"
                          : expanded
                          ? "bg-surface border border-border text-text-muted hover:bg-black/5"
                          : "bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20"
                      }`}
                    >
                      {added ? "Added" : expanded ? "Cancel" : "+ Add"}
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-3 py-2 bg-surface/40 border-t border-border flex flex-col gap-2">
                      {isLoadingTools && (
                        <div className="flex items-center gap-2 text-text-muted text-[10px] py-1">
                          <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                          <span>Probing server for tools...</span>
                        </div>
                      )}
                      {!isLoadingTools && cache?.requiresAuth && (
                        <p className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-1 rounded">
                          🔐 OAuth required. Add now and authenticate after Apply; tool list will be discovered after first connect.
                        </p>
                      )}
                      {!isLoadingTools && cache?.error && !cache?.requiresAuth && (
                        <p className="text-[10px] text-red-600 bg-red-500/10 px-2 py-1 rounded">Probe failed: {cache.error}</p>
                      )}
                      {!isLoadingTools && toolKeys.length === 0 && !cache?.requiresAuth && !cache?.error && (
                        <p className="text-[10px] text-text-muted">No tools advertised by server.</p>
                      )}
                      {!isLoadingTools && toolKeys.length > 0 && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-text-muted">{selectedCount}/{toolKeys.length} tools enabled</span>
                            <div className="flex gap-1">
                              <button onClick={() => setAllTools(s.url, true)} className="text-[10px] text-primary hover:underline">All</button>
                              <span className="text-[10px] text-text-muted">·</span>
                              <button onClick={() => setAllTools(s.url, false)} className="text-[10px] text-primary hover:underline">None</button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                            {toolKeys.map((t) => (
                              <label key={t} className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 px-1 rounded">
                                <input
                                  type="checkbox"
                                  checked={!!sel[t]}
                                  onChange={() => toggleTool(s.url, t)}
                                  className="size-3"
                                />
                                <span className="truncate">{t}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                      <button
                        onClick={() => confirmAdd(s)}
                        className="self-end px-2 py-1 rounded text-[10px] font-medium bg-primary text-white hover:bg-primary/90"
                      >
                        ✓ Confirm Add
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[10px] text-text-muted text-right">
          {filtered.length} of {servers.length} servers
        </div>
      </div>
    </Modal>
  );
}
