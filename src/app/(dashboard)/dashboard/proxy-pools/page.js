"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

function getStatusVariant(status) {
  if (status === "active") return "success";
  if (status === "error") return "error";
  return "default";
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function normalizeFormData(data = {}) {
  return {
    name: data.name || "",
    proxyUrl: data.proxyUrl || "",
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

export default function ProxyPoolsPage() {
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [showVercelModal, setShowVercelModal] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [vercelForm, setVercelForm] = useState({ vercelToken: "", projectName: "vercel-relay" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const notify = useNotificationStore();

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.log("Error fetching proxy pools:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProxyPools();
  }, [fetchProxyPools]);

  const resetForm = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (proxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    resetForm();
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const res = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchProxyPools();
        closeFormModal();
        notify.success(editingProxyPool ? "Proxy pool updated" : "Proxy pool created");
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      console.log("Error saving proxy pool:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool) => {
    const deleting = confirm(`Delete proxy pool \"${proxyPool.name}\"?`);
    if (!deleting) return;

    try {
      const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
      if (res.ok) {
        setProxyPools((prev) => prev.filter((item) => item.id !== proxyPool.id));
        notify.success("Proxy pool deleted");
        return;
      }

      const data = await res.json();
      if (res.status === 409) {
        notify.warning(`Cannot delete: ${data.boundConnectionCount || 0} connection(s) are still using this pool.`);
      } else {
        notify.error(data.error || "Failed to delete proxy pool");
      }
    } catch (error) {
      console.log("Error deleting proxy pool:", error);
      notify.error("Failed to delete proxy pool");
    }
  };

  const handleTest = async (proxyPoolId) => {
    setTestingId(proxyPoolId);
    try {
      const res = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        notify.error(data.error || "Failed to test proxy");
        return;
      }

      await fetchProxyPools();
      notify.success(data.ok ? "Proxy test passed" : "Proxy test failed");
    } catch (error) {
      console.log("Error testing proxy pool:", error);
      notify.error("Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  const closeBatchImportModal = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };

  const openVercelModal = () => {
    setVercelForm({ vercelToken: "", projectName: "vercel-relay" });
    setShowVercelModal(true);
  };

  const closeVercelModal = () => {
    if (deploying) return;
    setShowVercelModal(false);
  };

  const handleVercelDeploy = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/vercel-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vercelForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeVercelModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Vercel relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const parseProxyLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (trimmed.includes("://")) {
      const parsed = new URL(trimmed);
      const hostLabel = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${hostLabel}`,
      };
    }

    const parts = trimmed.split(":");
    if (parts.length === 4) {
      const [host, port, username, password] = parts;
      if (!host || !port || !username || !password) {
        throw new Error("Invalid host:port:user:pass format");
      }

      const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
      const parsed = new URL(proxyUrl);
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${host}:${port}`,
      };
    }

    throw new Error("Unsupported format");
  };

  const handleBatchImport = async () => {
    const lines = batchImportText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      notify.warning("Please paste at least one proxy line.");
      return;
    }

    const parsedEntries = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) {
          parsedEntries.push({
            ...parsed,
            lineNumber: index + 1,
          });
        }
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });

    if (invalidLines.length > 0) {
      notify.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys = new Set(
        proxyPools.map((pool) => `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`)
      );

      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const entry of parsedEntries) {
        const dedupeKey = `${entry.proxyUrl}|||`;
        if (existingKeys.has(dedupeKey)) {
          skipped += 1;
          continue;
        }

        const res = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            proxyUrl: entry.proxyUrl,
            noProxy: "",
            isActive: true,
          }),
        });

        if (res.ok) {
          created += 1;
          existingKeys.add(dedupeKey);
        } else {
          failed += 1;
        }
      }

      await fetchProxyPools();
      setShowBatchImportModal(false);
      notify.success(`Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`);
    } catch (error) {
      console.log("Error batch importing proxies:", error);
      notify.error("Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools]
  );

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Proxy Pools</h1>
          <p className="text-sm text-text-muted mt-1">
            Manage reusable per-connection proxies and bind them to provider connections.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <Button variant="secondary" icon="cloud_upload" onClick={openVercelModal}>
            Vercel Relay
          </Button>
          <Button variant="secondary" icon="upload" onClick={openBatchImportModal}>
            Batch Import
          </Button>
          <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Total: {proxyPools.length}</Badge>
            <Badge variant="success">Active: {activeCount}</Badge>
          </div>
        </div>

        {proxyPools.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium mb-1">No proxy pool entries yet</p>
            <p className="text-sm text-text-muted mb-4">
              Create a proxy pool entry, then assign it to connections.
            </p>
            <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {proxyPools.map((pool) => (
              <div key={pool.id} className="group flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="min-w-0 max-w-full truncate text-sm font-medium sm:max-w-[18rem]">{pool.name}</p>
                    <Badge variant={getStatusVariant(pool.testStatus)} size="sm" dot>
                      {pool.testStatus || "unknown"}
                    </Badge>
                    <Badge variant={pool.isActive ? "success" : "default"} size="sm">
                      {pool.isActive ? "active" : "inactive"}
                    </Badge>
                    {pool.type === "vercel" && (
                      <Badge variant="default" size="sm">vercel relay</Badge>
                    )}
                    <Badge variant="default" size="sm">
                      {pool.boundConnectionCount || 0} bound
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted truncate mt-1">{pool.proxyUrl}</p>
                  {pool.noProxy ? (
                    <p className="text-xs text-text-muted truncate">No proxy: {pool.noProxy}</p>
                  ) : null}
                  <p className="text-[11px] text-text-muted mt-1">
                    Last tested: {formatDateTime(pool.lastTestedAt)}
                    {pool.lastError ? ` · ${pool.lastError}` : ""}
                  </p>
                </div>

                <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <button
                    onClick={() => handleTest(pool.id)}
                    className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                    title="Test proxy"
                    disabled={testingId === pool.id}
                  >
                    <span
                      className="material-symbols-outlined text-[18px]"
                      style={testingId === pool.id ? { animation: "spin 1s linear infinite" } : undefined}
                    >
                      {testingId === pool.id ? "progress_activity" : "science"}
                    </span>
                  </button>
                  <button
                    onClick={() => openEditModal(pool)}
                    className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                    title="Edit"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </button>
                  <button
                    onClick={() => handleDelete(pool)}
                    className="p-2 rounded hover:bg-red-500/10 text-red-500"
                    title="Delete"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        isOpen={showBatchImportModal}
        title="Batch Import Proxies"
        onClose={closeBatchImportModal}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-text-main mb-1 block">Paste Proxy List (One per line)</label>
            <textarea
              value={batchImportText}
              onChange={(e) => setBatchImportText(e.target.value)}
              placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"}
              className="w-full min-h-[180px] py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all"
            />
            <p className="text-xs text-text-muted mt-1">
              Supported formats: protocol://user:pass@host:port, host:port:user:pass
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleBatchImport} disabled={!batchImportText.trim() || importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeBatchImportModal} disabled={importing}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showVercelModal}
        title="Deploy Vercel Relay"
        onClose={closeVercelModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Vercel Relay?</p>
            <p className="text-xs text-text-muted">
              Deploys an edge relay function to Vercel. All AI provider requests will be forwarded through Vercel&apos;s edge network, masking your real IP from providers.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Your IP is replaced by Vercel&apos;s dynamic edge IPs (hundreds of IPs across 20+ global regions)</li>
              <li>Vercel serves millions of apps — providers can&apos;t block Vercel IPs without affecting legitimate traffic</li>
              <li>Free tier: 100GB bandwidth/month, 500K edge invocations</li>
              <li>Deploy multiple relays on different accounts for more IP diversity</li>
            </ul>
          </div>
          <Input
            label="Vercel API Token"
            value={vercelForm.vercelToken}
            onChange={(e) => setVercelForm((prev) => ({ ...prev, vercelToken: e.target.value }))}
            placeholder="your-vercel-api-token"
            hint={<>Token is used once for deployment and not stored. <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}
            type="password"
          />
          <Input
            label="Project Name"
            value={vercelForm.projectName}
            onChange={(e) => setVercelForm((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="my-relay"
            hint="Unique name for your Vercel project. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleVercelDeploy}
              disabled={!vercelForm.vercelToken.trim() || deploying}
            >
              {deploying ? "Deploying... (may take ~1 min)" : "Deploy"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeVercelModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showFormModal}
        title={editingProxyPool ? "Edit Proxy Pool" : "Add Proxy Pool"}
        onClose={closeFormModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Office Proxy"
          />
          <Input
            label="Proxy URL"
            value={formData.proxyUrl}
            onChange={(e) => setFormData((prev) => ({ ...prev, proxyUrl: e.target.value }))}
            placeholder="http://127.0.0.1:7897"
          />
          <Input
            label="No Proxy"
            value={formData.noProxy}
            onChange={(e) => setFormData((prev) => ({ ...prev, noProxy: e.target.value }))}
            placeholder="localhost,127.0.0.1,.internal"
            hint="Comma-separated hosts/domains to bypass proxy"
          />

          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Active</p>
              <p className="text-xs text-text-muted">Inactive pools are ignored by runtime resolution.</p>
            </div>
            <Toggle
              checked={formData.isActive === true}
              onChange={() => setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))}
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Strict Proxy</p>
              <p className="text-xs text-text-muted">Fail request if proxy is unreachable instead of falling back to direct.</p>
            </div>
            <Toggle
              checked={formData.strictProxy === true}
              onChange={() => setFormData((prev) => ({ ...prev, strictProxy: !prev.strictProxy }))}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.proxyUrl.trim() || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeFormModal} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
