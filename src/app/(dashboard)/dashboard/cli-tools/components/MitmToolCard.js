"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Badge, Input, ModelSelectModal } from "@/shared/components";
import Image from "next/image";

/**
 * Per-tool MITM card — shows DNS status + model mappings.
 * - Auto-saves model mapping on blur or modal select
 * - Skips sudo modal if password is already cached
 * - Model mappings can only be edited when DNS is active
 */
export default function MitmToolCard({
  tool,
  isExpanded,
  onToggle,
  serverRunning,
  dnsActive,
  hasCachedPassword,
  apiKeys,
  activeProviders,
  hasActiveProviders,
  modelAliases = {},
  cloudEnabled,
  onDnsChange,
}) {
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");
  const [pendingDnsAction, setPendingDnsAction] = useState(null);
  const [modalError, setModalError] = useState(null);
  const [modelMappings, setModelMappings] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);

  // Detect the SERVER's OS, not the browser's — fixes WSL2 + Windows browser false-positive
  const isWindows = typeof window !== "undefined" && window._9r_serverOS === "win32";

  useEffect(() => {
    if (isExpanded) loadSavedMappings();
  }, [isExpanded]);

  const loadSavedMappings = async () => {
    try {
      const res = await fetch(`/api/cli-tools/antigravity-mitm/alias?tool=${tool.id}`);
      if (res.ok) {
        const data = await res.json();
        if (Object.keys(data.aliases || {}).length > 0) setModelMappings(data.aliases);
      }
    } catch { /* ignore */ }
  };

  const saveMappings = useCallback(async (mappings) => {
    try {
      await fetch("/api/cli-tools/antigravity-mitm/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.id, mappings }),
      });
    } catch { /* ignore */ }
  }, [tool.id]);

  const handleMappingBlur = (alias, value) => {
    saveMappings({ ...modelMappings, [alias]: value });
  };

  const handleModelMappingChange = (alias, value) => {
    setModelMappings(prev => ({ ...prev, [alias]: value }));
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (!currentEditingAlias || model.isPlaceholder) return;
    const updated = { ...modelMappings, [currentEditingAlias]: model.value };
    setModelMappings(updated);
    saveMappings(updated);
  };

  const handleDnsToggle = () => {
    if (!serverRunning) return;
    const action = dnsActive ? "disable" : "enable";
    if (isWindows || hasCachedPassword) {
      doDnsAction(action, "");
    } else {
      setPendingDnsAction(action);
      setShowPasswordModal(true);
      setModalError(null);
    }
  };

  const doDnsAction = async (action, password) => {
    setLoading(true);
    setWarning(null);
    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.id, action, sudoPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle DNS");

      if (action === "enable") {
        setWarning(`Restart ${tool.name} to apply changes`);
      }

      setShowPasswordModal(false);
      setSudoPassword("");
      onDnsChange?.(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setPendingDnsAction(null);
    }
  };

  const handleConfirmPassword = () => {
    if (!sudoPassword.trim()) {
      setModalError("Sudo password is required");
      return;
    }
    doDnsAction(pendingDnsAction, sudoPassword);
  };

  return (
    <>
      <Card padding="xs" className="overflow-hidden">
        <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
          <div className="flex items-center gap-3">
            <div className="size-8 flex items-center justify-center shrink-0">
              <Image
                src={tool.image}
                alt={tool.name}
                width={32}
                height={32}
                className="size-8 object-contain rounded-lg"
                sizes="32px"
                onError={(e) => { e.target.style.display = "none"; }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">{tool.name}</h3>
                {!serverRunning ? (
                  <Badge variant="default" size="sm">Server off</Badge>
                ) : dnsActive ? (
                  <Badge variant="success" size="sm">Active</Badge>
                ) : (
                  <Badge variant="warning" size="sm">DNS off</Badge>
                )}
              </div>
              <p className="text-xs text-text-muted">Intercept {tool.name} requests via MITM proxy</p>
            </div>
          </div>
          <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </div>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
            {/* Info */}
            <div className="flex flex-col gap-0.5 text-[11px] text-text-muted px-1">
              <p>Toggle DNS to redirect {tool.name} traffic through 9Router via MITM.</p>
              {!dnsActive && (
                <p className="text-amber-600 text-[10px] mt-1">
                  ⚠️ Enable DNS to edit model mappings
                </p>
              )}
            </div>

            {/* Model Mappings */}
            {tool.defaultModels?.length > 0 && (
              <div className="flex flex-col gap-2">
                {tool.defaultModels.map((model) => (
                  <div key={model.alias} className="flex items-center gap-2">
                    <span className="w-36 shrink-0 text-xs font-semibold text-text-main text-right">{model.name}</span>
                    <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                    <input
                      type="text"
                      value={modelMappings[model.alias] || ""}
                      onChange={(e) => handleModelMappingChange(model.alias, e.target.value)}
                      onBlur={(e) => handleMappingBlur(model.alias, e.target.value)}
                      placeholder="provider/model-id"
                      disabled={!dnsActive}
                      className={`flex-1 px-2 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 ${!dnsActive ? "opacity-50 cursor-not-allowed" : ""}`}
                    />
                    <button
                      onClick={() => openModelSelector(model.alias)}
                      disabled={!hasActiveProviders || !dnsActive}
                      className={`px-2 py-1.5 rounded border text-xs transition-colors shrink-0 ${hasActiveProviders && dnsActive ? "bg-surface border-border hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                    >
                      Select
                    </button>
                    {modelMappings[model.alias] && (
                      <button
                        onClick={() => {
                          handleModelMappingChange(model.alias, "");
                          saveMappings({ ...modelMappings, [model.alias]: "" });
                        }}
                        className="p-1 text-text-muted hover:text-red-500 rounded transition-colors"
                        title="Clear"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tool.defaultModels?.length === 0 && (
              <p className="text-xs text-text-muted px-1">Model mappings will be available soon.</p>
            )}

            {/* Start / Stop DNS button */}
            <div className="flex flex-col gap-2 items-start">
              {dnsActive ? (
                <button
                  onClick={handleDnsToggle}
                  disabled={!serverRunning || loading}
                  className="px-4 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 font-medium text-xs flex items-center gap-1.5 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[16px]">stop_circle</span>
                  Stop DNS
                </button>
              ) : (
                <button
                  onClick={handleDnsToggle}
                  disabled={!serverRunning || loading}
                  className="px-4 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary font-medium text-xs flex items-center gap-1.5 hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[16px]">play_circle</span>
                  Start DNS
                </button>
              )}

              {/* Warning below button */}
              {warning && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-amber-500">
                  <span className="material-symbols-outlined text-[14px]">warning</span>
                  <span>{warning}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-xl">
            <h3 className="font-semibold text-text-main">Sudo Password Required</h3>
            <div className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <span className="material-symbols-outlined text-yellow-500 text-[20px]">warning</span>
              <p className="text-xs text-text-muted">Required to modify /etc/hosts and flush DNS cache</p>
            </div>
            <Input
              type="password"
              placeholder="Enter sudo password"
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleConfirmPassword(); }}
            />
            {modalError && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-red-500/10 text-red-600">
                <span className="material-symbols-outlined text-[14px]">error</span>
                <span>{modalError}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowPasswordModal(false); setSudoPassword(""); setModalError(null); }} disabled={loading}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleConfirmPassword} loading={loading}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Model Select Modal */}
      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleModelSelect}
        selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={`Select model for ${currentEditingAlias}`}
      />
    </>
  );
}
