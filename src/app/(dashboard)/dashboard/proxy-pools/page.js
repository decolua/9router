"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Pagination, Toggle, ConfirmModal, PageShell } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { useTaskStore } from "@/store/taskStore";
import {
  startProxyImportJob,
  pollProxyImportJob,
  cancelProxyImportJob,
  readStoredJob,
  writeStoredJob,
} from "@/shared/utils/proxyImportClient";
import {
  startDashboardJob,
  pollDashboardJob,
  cancelDashboardJob,
  fetchDashboardJob,
  readStoredDashboardJob,
  clearStoredDashboardJob,
} from "@/shared/utils/dashboardJobsClient";

// One task id for the batch import, shared by the loop, the seed of `importing`
// after a navigation, and the banner in the layout dock.
const PROXY_IMPORT_TASK = "proxy-pools-import";

// One task id per operation kind, so the banner, the bell, and a reloaded page
// all talk about the same run.
const dashboardTaskId = (kind) => `dashboard-job-${kind}`;

/**
 * Adopt a server-side job: put its banner up, follow its progress, and hand
 * the finished record to `onFinal`. The job itself belongs to the server, so
 * an operator who closes the browser here still gets the work; the reattach
 * path below simply runs this again after a reload.
 */
const followDashboardJob = async (kind, jobId, { title, pollMs = 1000, onFinal }) => {
  const taskId = dashboardTaskId(kind);
  useTaskStore.getState().start({
    id: taskId,
    title,
    message: "Starting",
    progress: 0,
    href: "/dashboard/proxy-pools",
    onCancel: () => cancelDashboardJob(jobId),
  });
  try {
    const final = await pollDashboardJob(
      jobId,
      (job) => {
        useTaskStore.getState().update(taskId, {
          message: job.message || "",
          progress: typeof job.progress === "number" ? job.progress : 0,
        });
      },
      { pollMs }
    );
    if (final) onFinal?.(final);
  } finally {
    useTaskStore.getState().finish(taskId);
  }
};

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
  const [showCloudflareModal, setShowCloudflareModal] = useState(false);
  const [showDenoModal, setShowDenoModal] = useState(false);
  const [showNetlifyModal, setShowNetlifyModal] = useState(false);
  const [showRelayMenu, setShowRelayMenu] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [vercelForm, setVercelForm] = useState({ vercelToken: "", projectName: "vercel-relay" });
  const [cloudflareForm, setCloudflareForm] = useState({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
  const [denoForm, setDenoForm] = useState({ denoToken: "", orgDomain: "", projectName: "" });
  const [netlifyForm, setNetlifyForm] = useState({ netlifyToken: "", projectName: "netlify-relay" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(() =>
    // A finished run lingers in the store marked `done` (see taskStore.finish),
    // so presence alone no longer means the import is in flight.
    useTaskStore
      .getState()
      .tasks.some((t) => t.id === PROXY_IMPORT_TASK && t.state !== "done")
  );
  const importAbortRef = useRef(null);
  const [deploying, setDeploying] = useState(false);
  const [deployLabel, setDeployLabel] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  // The row markup is heavy, so a large import used to render every pool at
  // once and lock the page up. A page window plus a filter bounds the DOM.
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("all");
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthProgress, setHealthProgress] = useState({ current: 0, total: 0 });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const relayMenuRef = useRef(null);
  const notify = useNotificationStore();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (relayMenuRef.current && !relayMenuRef.current.contains(e.target)) {
        setShowRelayMenu(false);
      }
    };
    if (showRelayMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRelayMenu]);

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
    setConfirmState({
      title: "Delete Proxy Pool",
      message: `Delete proxy pool "${proxyPool.name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
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
      }
    });
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

  const handleToggleActive = async (pool) => {
    const next = !pool.isActive;
    setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: next } : p));
    try {
      const res = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
        notify.error("Failed to update active state");
      }
    } catch (error) {
      console.log("Error toggling active:", error);
      setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const filteredPools = useMemo(() => {
    const q = search.trim().toLowerCase();
    return proxyPools.filter((pool) => {
      if (statusFilter === "active" && pool.isActive !== true) return false;
      if (statusFilter === "inactive" && pool.isActive === true) return false;
      if (statusFilter === "unbound" && (pool.boundConnectionCount || 0) > 0) return false;
      if (!q) return true;
      return (
        String(pool.name || "").toLowerCase().includes(q) ||
        String(pool.proxyUrl || "").toLowerCase().includes(q)
      );
    });
  }, [proxyPools, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPools.length / pageSize));
  // Clamping in render (not in an effect) keeps one source of truth and
  // avoids a paint where the list is briefly the wrong page.
  const safePage = Math.min(page, totalPages);
  const visiblePools = useMemo(
    () => filteredPools.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredPools, safePage, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize]);

  // Select-all spans the whole filtered list, not just the visible page window.
  // The old code selected the 20 visible rows only, so with hundreds of pools
  // "Select all" silently left the rest behind.
  const allSelected =
    filteredPools.length > 0 && filteredPools.every((p) => selectedIds.includes(p.id));
  // Bulk actions still act on the whole selection across pages; the checkbox
  // only ever refers to the visible window.
  const someVisibleSelected = visiblePools.some((p) => selectedIds.includes(p.id));

  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : filteredPools.map((p) => p.id));
  const clearSelection = () => setSelectedIds([]);

  const bulkSetActive = async (isActive) => {
    const targets = selectedIds.length > 0 ? selectedIds : proxyPools.map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0; let failed = 0;
      for (const id of targets) {
        try {
          const res = await fetch(`/api/proxy-pools/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive }),
          });
          if (res.ok) ok += 1; else failed += 1;
        } catch { failed += 1; }
      }
      await fetchProxyPools();
      notify.success(`${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  // Shared by "Delete selected" and "Delete all": one request to
  // /api/proxy-pools/bulk, which deletes in a single transaction. The old loop
  // asked the server once per id, so clearing hundreds of pools meant hundreds
  // of round trips and a half-finished delete if the tab closed midway.
  const runBulkDelete = async ({ ids = null, all = false, boundLabel }) => {
    // Close the confirm dialog before the request: bulkDelete used to do this
    // inline, and ConfirmModal stays mounted until confirmState is cleared.
    setConfirmState(null);
    setBulkBusy(true);
    try {
      const res = await fetch("/api/proxy-pools/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? { all: true } : { ids }),
      });

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        notify.error(
          `${data.boundConnectionCount ?? "Some"} connection(s) still use a selected proxy pool. Unbind them first.`
        );
        return;
      }
      if (!res.ok) {
        notify.error("Failed to delete proxy pools");
        return;
      }

      const data = await res.json().catch(() => ({}));
      const deletedCount = data.deletedCount ?? (data.deleted?.length ?? 0);
      await fetchProxyPools();
      clearSelection();

      if (deletedCount === 0) {
        notify.error("Nothing deleted: every selected pool is still bound to a connection");
        return;
      }
      notify.success(
        `Deleted ${deletedCount}${boundLabel}`
      );
    } catch (error) {
      console.error("Error deleting proxy pools:", error);
      notify.error("Failed to delete proxy pools");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: "Delete Proxy Pools",
      message: `Delete ${selectedIds.length} proxy pool(s)? This cannot be undone.`,
      onConfirm: () => runBulkDelete({
        ids: selectedIds,
        boundLabel: selectedIds.length === 1 ? " proxy pool" : " proxy pools",
      }),
    });
  };

  // Deletes everything on the server, not just the current page or filter, so
  // it is unaffected by how much of the list the browser happens to have loaded.
  const deleteAllPools = () => {
    if (proxyPools.length === 0) return;
    const boundCount = proxyPools.reduce((sum, p) => sum + (p.boundConnectionCount || 0), 0);
    setConfirmState({
      title: "Delete All Proxy Pools",
      message: boundCount > 0
        ? `This deletes all ${proxyPools.length} proxy pool(s). ${boundCount} connection(s) are still bound to a pool and will be left untouched. This cannot be undone.`
        : `This deletes all ${proxyPools.length} proxy pool(s). This cannot be undone.`,
      onConfirm: () => runBulkDelete({
        all: true,
        boundLabel: " proxy pools",
      }),
    });
  };

  // The pool list can hold six thousand entries, and testing them is one request
  // each - minutes of work that used to be driven by this component. If the tab
  // closed mid-run the loop died with it and the health status was left half
  // written, so the work now belongs to the server: one POST starts it, this
  // page only reads progress, and the banner and the bell can show it after a
  // reload or from another menu.
  const handleHealthCheck = async () => {
    const targets = selectedIds.length > 0
      ? proxyPools.filter((p) => selectedIds.includes(p.id))
      : proxyPools;
    if (targets.length === 0) return;

    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });

    try {
      const { jobId, pollMs } = await startDashboardJob(
        "health-check",
        { poolIds: targets.map((p) => p.id) },
        "Health check"
      );
      await followDashboardJob("health-check", jobId, {
        title: "Health check",
        pollMs,
        onFinal: (job) => {
          if (job.status === "cancelled") {
            notify.info(job.message || "Health check stopped");
            return;
          }
          if (job.status !== "done") {
            notify.error(job.error || job.message || "Health check failed");
            return;
          }
          const deadIds = job.result?.deadIds || [];
          if (deadIds.length > 0) {
            setConfirmState({
              title: "Disable Dead Proxies",
              message: `Alive: ${job.result.alive}, Dead: ${deadIds.length}.\n\nDisable ${deadIds.length} dead proxies?`,
              onConfirm: async () => {
                setConfirmState(null);
                setBulkBusy(true);
                try {
                  for (const id of deadIds) {
                    try {
                      await fetch(`/api/proxy-pools/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ isActive: false }),
                      });
                    } catch {}
                  }
                  await fetchProxyPools();
                  notify.success(`Disabled ${deadIds.length} dead proxies`);
                } finally {
                  setBulkBusy(false);
                }
              },
            });
          } else {
            notify.success(job.message || "Health check done");
          }
        },
      });
    } catch (error) {
      notify.error(error?.message || "Could not start the health check");
    } finally {
      await fetchProxyPools();
      setHealthChecking(false);
      setHealthProgress({ current: 0, total: 0 });
    }
  };

  // Reattach to a health check that outlived this page. The server kept it
  // running, so this only reconnects the banner - it never starts a new run.
  useEffect(() => {
    const stored = readStoredDashboardJob("health-check");
    if (!stored) return;
    let alive = true;
    (async () => {
      const job = await fetchDashboardJob(stored.jobId);
      if (!alive) return;
      if (!job || job.status === "done" || job.status === "error" || job.status === "cancelled") {
        clearStoredDashboardJob("health-check");
        return;
      }
      setHealthChecking(true);
      setHealthProgress({
        current: 0,
        total: Number(job.result?.total) || 0,
      });
      await followDashboardJob("health-check", stored.jobId, {
        title: "Health check",
        onFinal: (final) => {
          clearStoredDashboardJob("health-check");
          if (!alive) return;
          if (final.status === "done") {
            notify.success(final.message || "Health check done");
          } else if (final.status === "cancelled") {
            notify.info(final.message || "Health check stopped");
          } else {
            notify.error(final.error || final.message || "Health check failed");
          }
        },
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup selectedIds when pools change
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => proxyPools.some((p) => p.id === id)));
  }, [proxyPools]);

  // Reattach after a navigation or reload: the server keeps the run going, so a
  // stored job id only needs its progress banner back, not a new run.
  useEffect(() => {
    const stored = readStoredJob();
    if (!stored) return;
    let alive = true;
    (async () => {
      const total = stored.total || 0;
      setImporting(true);
      importAbortRef.current = stored.jobId;
      useTaskStore.getState().start({
        id: PROXY_IMPORT_TASK,
        title: "Importing proxies",
        message: `0/${total} proxies`,
        progress: 0,
        href: "/dashboard/proxy-pools",
        onCancel: () => cancelProxyImportJob(stored.jobId),
      });
      const final = await pollProxyImportJob(
        stored.jobId,
        (job) => {
          if (!alive) return;
          useTaskStore.getState().update(PROXY_IMPORT_TASK, {
            message: job.message || `${job.counts?.processed ?? 0}/${total} proxies`,
            progress: Number(job.progress) || 0,
          });
        },
        { pollMs: 1000 }
      );
      if (!alive) return;
      if (final?.status === "done") {
        await fetchProxyPools();
        notify.success(final.message || "Batch import completed");
      } else if (final?.status === "cancelled") {
        await fetchProxyPools();
        notify.info(final.message || "Batch import stopped");
      } else if (final?.status === "error") {
        notify.error(final.error || final.message || "Batch import failed");
      }
      useTaskStore.getState().finish(PROXY_IMPORT_TASK);
      importAbortRef.current = null;
      setImporting(false);
    })();
    return () => {
      alive = false;
    };
    // One shot on mount: this reconnects to a run that outlived the page, and
    // polling keeps going through `pollProxyImportJob` even across later
    // navigations while the task store keeps the banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  // No `importing` guard: the modal is already closed once a run starts, and
  // the docked banner owns Cancel. Re-opening the dialog mid-run to paste a
  // different list is harmless - handleBatchImport refuses a second run itself.
  const closeBatchImportModal = () => {
    setShowBatchImportModal(false);
  };

  const openVercelModal = () => {
    setVercelForm({ vercelToken: "", projectName: "vercel-relay" });
    setShowVercelModal(true);
  };

  // No `deploying` guard. Both guards below were wrong twice over: the modal
  // kept its own `fixed inset-0` overlay on screen for the whole deploy, and the
  // success path called these closers *while* `deploying` was still true, so
  // `if (deploying) return` turned the close into a no-op and the dialog never
  // went away. Deploy progress is announced through the bell task store.
  const closeVercelModal = () => {
    setShowVercelModal(false);
  };

  const openCloudflareModal = () => {
    setCloudflareForm({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
    setShowCloudflareModal(true);
  };

  const closeCloudflareModal = () => {
    setShowCloudflareModal(false);
  };

  const openDenoModal = () => {
    setDenoForm({ denoToken: "", orgDomain: "", projectName: "" });
    setShowDenoModal(true);
  };

  const closeDenoModal = () => {
    setShowDenoModal(false);
  };


  // Relay deploys are one long request each (the provider builds, uploads, and
  // reports ready). The dialog closes the moment the request starts and the run
  // belongs to the server, so closing the browser during a minute-long deploy
  // no longer loses it: the banner follows it here, and a reload reattaches.
  const runRelayDeploy = async (provider, form, { label, onDone }) => {
    setDeployLabel(label);
    setDeploying(true);
    try {
      const { jobId, pollMs } = await startDashboardJob(
        "deploy-relay",
        { provider, form },
        label
      );
      await followDashboardJob("deploy-relay", jobId, {
        title: label,
        pollMs,
        onFinal: async (job) => {
          await fetchProxyPools();
          onDone?.();
          if (job.status === "done") {
            notify.success(job.message || "Deployed");
          } else if (job.status === "cancelled") {
            notify.info(job.message || "Deploy cancelled");
          } else {
            notify.error(job.error || job.message || "Deploy failed");
          }
        },
      });
    } catch (error) {
      notify.error(error?.message || "Deploy failed");
    } finally {
      setDeploying(false);
      setDeployLabel(null);
    }
  };

  const openNetlifyModal = () => {
    setNetlifyForm({ netlifyToken: "", projectName: "netlify-relay" });
    setShowNetlifyModal(true);
  };

  const closeNetlifyModal = () => {
    setShowNetlifyModal(false);
  };

  const handleVercelDeploy = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setShowVercelModal(false);
    await runRelayDeploy("vercel", vercelForm, {
      label: "Deploying Vercel Relay",
      onDone: closeVercelModal,
    });
  };

  const handleCloudflareDeploy = async () => {
    if (!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim()) return;
    setShowCloudflareModal(false);
    await runRelayDeploy("cloudflare", cloudflareForm, {
      label: "Deploying Cloudflare Worker",
      onDone: closeCloudflareModal,
    });
  };

  const handleDenoDeploy = async () => {
    if (!denoForm.denoToken.trim() || !denoForm.orgDomain.trim()) return;
    setShowDenoModal(false);
    await runRelayDeploy("deno", denoForm, {
      label: "Deploying Deno Relay",
      onDone: closeDenoModal,
    });
  };

  const handleNetlifyDeploy = async () => {
    if (!netlifyForm.netlifyToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/netlify-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(netlifyForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeNetlifyModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Netlify relay:", error);
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
    // Close the modal as soon as the run starts. Its `fixed inset-0` overlay
    // used to stay mounted with both buttons disabled and swallowed every click
    // on the page. Progress reports through the task store, which survives
    // navigation and surfaces in the notification bell.
    setShowBatchImportModal(false);

    const total = parsedEntries.length;
    try {
      // The insert loop now runs on the server: posting a thousand entries one
      // round trip at a time from the page meant the run died with the tab, so
      // closing the browser or refreshing halfway left the list half-imported
      // with no resume. The server keeps going and this page only reads
      // progress, which is also what lets the operator navigate elsewhere.
      const { jobId, pollMs } = await startProxyImportJob(parsedEntries);
      writeStoredJob(jobId, total);
      importAbortRef.current = jobId;
      useTaskStore.getState().start({
        id: PROXY_IMPORT_TASK,
        title: "Importing proxies",
        message: `0/${total} proxies`,
        progress: 0,
        href: "/dashboard/proxy-pools",
        onCancel: () => cancelProxyImportJob(jobId),
      });

      const final = await pollProxyImportJob(
        jobId,
        (job) => {
          useTaskStore.getState().update(PROXY_IMPORT_TASK, {
            message: job.message || `${job.counts?.processed ?? 0}/${total} proxies`,
            progress: Number(job.progress) || 0,
          });
        },
        { pollMs }
      );

      if (final?.status === "done") {
        await fetchProxyPools();
        notify.success(final.message || "Batch import completed");
      } else if (final?.status === "cancelled") {
        await fetchProxyPools();
        notify.info(final.message || "Batch import stopped");
      } else if (final?.status === "error") {
        notify.error(final.error || final.message || "Batch import failed");
      }
      // A null final means the record expired (server restarted, or the run
      // outlived its TTL). No toast either way: nothing is known to have gone
      // wrong, and claiming otherwise would be the worse lie.
    } catch (error) {
      console.log("Error starting proxy import:", error);
      notify.error(error?.message || "Batch import failed");
    } finally {
      useTaskStore.getState().finish(PROXY_IMPORT_TASK);
      importAbortRef.current = null;
      setImporting(false);
    }
  };

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools]
  );

  if (loading) {
    return (
      <PageShell width="reading">
        <CardSkeleton />
        <CardSkeleton />
      </PageShell>
    );
  }

  return (
    <PageShell width="reading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Proxy Pools</h1>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <div className="relative" ref={relayMenuRef}>
            <Button
              size="sm"
              variant="secondary"
              icon="rocket_launch"
              onClick={() => setShowRelayMenu(!showRelayMenu)}
            >
              Deploy Relay
              <span className="material-symbols-outlined ml-1 text-[18px]">
                {showRelayMenu ? "expand_less" : "expand_more"}
              </span>
            </Button>

            {showRelayMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-surface p-1 shadow-xl sm:left-auto sm:right-0">
                <button
                  onClick={() => {
                    openCloudflareModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-surface-2"
                >
                  <span className="material-symbols-outlined text-[20px] text-orange-500">cloud</span>
                  Cloudflare Relay
                </button>
                <button
                  onClick={() => {
                    openVercelModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-surface-2"
                >
                  <span className="material-symbols-outlined text-[20px] text-blue-500">cloud_upload</span>
                  Vercel Relay
                </button>
                <button
                  onClick={() => {
                    openDenoModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-surface-2"
                >
                  <span className="material-symbols-outlined text-[20px] text-green-500">terminal</span>
                  Deno Relay
                </button>
                <button
                  onClick={() => {
                    openNetlifyModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-surface-2"
                >
                  <span className="material-symbols-outlined text-[20px] text-teal-500">deployed_code</span>
                  Netlify Relay
                </button>
              </div>
            )}
          </div>

          <Button size="sm" variant="secondary" icon="upload" onClick={openBatchImportModal}>
            Batch Import
          </Button>
          <Button size="sm" icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {proxyPools.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="size-4 rounded border-border-subtle"
              />
              {allSelected ? "Unselect all" : "Select all"}
            </label>
          )}
          <Badge variant="default">Total: {proxyPools.length}</Badge>
          <Badge variant="success">Active: {activeCount}</Badge>
          {proxyPools.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon="delete"
              onClick={deleteAllPools}
              disabled={bulkBusy || healthChecking}
              className="ml-auto"
              title="Delete every proxy pool at once"
            >
              Delete All
            </Button>
          )}
        </div>

        {(selectedIds.length > 0 || healthChecking) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="material-symbols-outlined text-[18px] text-primary">checklist</span>
            <span className="text-xs font-medium text-primary">
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : "All pools"}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon={healthChecking ? "progress_activity" : "health_and_safety"}
                onClick={handleHealthCheck}
                disabled={healthChecking || bulkBusy || proxyPools.length === 0}
              >
                {healthChecking ? `Checking ${healthProgress.current}/${healthProgress.total}` : "Health Check"}
              </Button>
              {selectedIds.length > 0 && (
                <>
                  <Button size="sm" variant="secondary" icon="toggle_on" onClick={() => bulkSetActive(true)} disabled={bulkBusy || healthChecking}>
                    Activate
                  </Button>
                  <Button size="sm" variant="secondary" icon="toggle_off" onClick={() => bulkSetActive(false)} disabled={bulkBusy || healthChecking}>
                    Deactivate
                  </Button>
                  <Button size="sm" variant="secondary" icon="delete" onClick={bulkDelete} disabled={bulkBusy || healthChecking}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy || healthChecking}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {proxyPools.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-4">
            <div className="flex-1 min-w-0">
              <Input
                placeholder="Search by name or proxy URL..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                icon="search"
                className="w-full"
              />
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-2">
              {[
                { id: "all", label: "All" },
                { id: "active", label: "Active" },
                { id: "inactive", label: "Inactive" },
                { id: "unbound", label: "Unbound" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStatusFilter(opt.id)}
                  aria-pressed={statusFilter === opt.id}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === opt.id
                      ? "bg-surface text-text-main shadow-sm"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">
              {filteredPools.length} of {proxyPools.length}
            </span>
          </div>
        )}

        {proxyPools.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium mb-1">No proxy pool entries yet</p>
            <p className="text-sm text-text-muted mb-4">
              Create a proxy pool entry, then assign it to connections.
            </p>
            <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
          </div>
        ) : filteredPools.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium mb-1">No proxy pools match this filter</p>
            <p className="text-sm text-text-muted mb-4">
              {proxyPools.length} entries are loaded. Clear the search or pick another status.
            </p>
            <Button
              variant="secondary"
              icon="filter_alt_off"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
            >
              Clear filter
            </Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle">
            {visiblePools.map((pool) => (
              <div key={pool.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(pool.id)}
                    onChange={() => toggleSelect(pool.id)}
                    className="mt-1 size-4 shrink-0 rounded border-border-subtle"
                  />
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
                    {pool.type === "cloudflare" && (
                      <Badge variant="default" size="sm">cloudflare relay</Badge>
                    )}
                    {pool.type === "deno" && (
                      <Badge variant="default" size="sm">deno relay</Badge>
                    )}
                    {pool.type === "netlify" && (
                      <Badge variant="default" size="sm">netlify relay</Badge>
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
                </div>

                <div className="flex items-center justify-end gap-1">
                  <Toggle
                    size="sm"
                    checked={pool.isActive === true}
                    onChange={() => handleToggleActive(pool)}
                    title={pool.isActive ? "Disable" : "Enable"}
                  />
                  <button
                    onClick={() => handleTest(pool.id)}
                    className="p-2 rounded hover:bg-surface-2 text-text-muted hover:text-primary"
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
                    className="p-2 rounded hover:bg-surface-2 text-text-muted hover:text-primary"
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

        {filteredPools.length > 0 && totalPages > 1 && (
          <Pagination
            currentPage={safePage}
            pageSize={pageSize}
            totalItems={filteredPools.length}
            onPageChange={setPage}
            onPageSizeChange={(n) => setPageSize(n)}
          />
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
              className="w-full min-h-[180px] py-2 px-3 text-sm text-text-main bg-surface border border-border rounded-md focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all"
            />
            <p className="text-xs text-text-muted mt-1">
              Supported formats: protocol://user:pass@host:port, host:port:user:pass
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleBatchImport} disabled={!batchImportText.trim() || importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeBatchImportModal}>
              {importing ? "Run in background" : "Cancel"}
            </Button>
          </div>
        </div>

        {/* The import banner lives in the task store so it survives
            navigation and shows in the notification bell; no second card
            inside the modal. */}
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
              Forwards all AI provider requests through Vercel&apos;s edge network so your real IP stays hidden.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Your IP is replaced by Vercel&apos;s dynamic edge IPs (hundreds of IPs across 20+ global regions)</li>
              <li>Vercel serves millions of apps - providers can&apos;t block Vercel IPs without affecting legitimate traffic</li>
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
            hint="Name for your Vercel project (leave empty to auto-generate)"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleVercelDeploy}
              disabled={!vercelForm.vercelToken.trim() || deploying}
            >
              Deploy
            </Button>
            <Button fullWidth variant="ghost" onClick={closeVercelModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showCloudflareModal}
        title="Deploy Cloudflare Relay"
        onClose={closeCloudflareModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Cloudflare Relay?</p>
            <p className="text-xs text-text-muted">
              Forwards all AI provider requests through Cloudflare&apos;s global edge network.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>High performance global routing and IP masking via Cloudflare Workers</li>
              <li>Free tier: 100,000 requests per day</li>
              <li>Requires Cloudflare Account ID and a Workers API Token (Edit Workers permission)</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-orange-500/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate your API Token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>My Profile</b> → <b>API Tokens</b> → <b>Create Token</b></li>
                <li>Scroll down to <b>Custom Token</b> and click <b>Get started</b></li>
                <li>Under <b>Permissions</b>: Account | Workers Scripts | Edit</li>
                <li>Under <b>Account Resources</b>: Include | Account | <i>Your Account Name</i></li>
                <li>Click <b>Continue to summary</b> → <b>Create Token</b></li>
              </ol>
            </div>
          </div>
          <Input
            label="Account ID"
            value={cloudflareForm.accountId}
            onChange={(e) => setCloudflareForm((prev) => ({ ...prev, accountId: e.target.value }))}
            placeholder="your-cloudflare-account-id"
            hint={<>Found on the right side of the Cloudflare dashboard overview page.</>}
          />
          <Input
            label="API Token"
            value={cloudflareForm.apiToken}
            onChange={(e) => setCloudflareForm((prev) => ({ ...prev, apiToken: e.target.value }))}
            placeholder="your-cloudflare-api-token"
            hint={<>Requires "Workers Scripts: Edit" permission. <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}
            type="password"
          />
          <Input
            label="Worker Name"
            value={cloudflareForm.projectName}
            onChange={(e) => setCloudflareForm((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="my-relay"
            hint="Name for your Cloudflare Worker (leave empty to auto-generate)"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleCloudflareDeploy}
              disabled={!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim() || deploying}
            >
              Deploy Worker
            </Button>
            <Button fullWidth variant="ghost" onClick={closeCloudflareModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDenoModal}
        title="Deploy Deno Relay"
        onClose={closeDenoModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-surface-2 border border-border p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Deno Relay?</p>
            <p className="text-xs text-text-muted">
              Forwards all AI provider requests through Deno&apos;s global edge network to mask your real IP.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Deno Deploy v2 runs on a high-performance global edge network</li>
              <li>Free tier: 1M requests & 100GiB outbound traffic per month</li>
              <li>No per-request CPU time limits (unlike Vercel/Cloudflare)</li>
              <li>Support up to 20 active apps & 50 custom domains</li>
              <li>Deploy multiple relays for maximum IP diversity</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-border text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate API token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>console.deno.com</b></li>
                <li>Select your <b>Organization</b> → <b>Settings</b> → <b>Organization Tokens</b></li>
                <li>Create a <b>Organization Token</b> (prefix <b>ddo_</b>)</li>
              </ol>
            </div>
          </div>
          <Input
            label="Deno Deploy API Token"
            value={denoForm.denoToken}
            onChange={(e) => setDenoForm((prev) => ({ ...prev, denoToken: e.target.value }))}
            placeholder="ddo_xxxxxxxxxxxxxxxx"
            hint={<>Used once for deployment and never stored (found in Organization Settings)</>}
            type="password"
          />
          <Input
            label="Organization Domain"
            value={denoForm.orgDomain}
            onChange={(e) => setDenoForm((prev) => ({ ...prev, orgDomain: e.target.value }))}
            placeholder="your-org.deno.net"
            hint="Organization's default domain. Your relay URL will be in the format: https://my-relay.your-org.deno.net"
          />
          <Input
            label="App Name"
            value={denoForm.projectName}
            onChange={(e) => setDenoForm((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="deno-relay"
            hint="App name (leave empty to auto-generate)"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleDenoDeploy}
              disabled={!denoForm.denoToken.trim() || !denoForm.orgDomain.trim() || deploying}
            >
              Deploy Relay
            </Button>
            <Button fullWidth variant="ghost" onClick={closeDenoModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showNetlifyModal}
        title="Deploy Netlify Relay"
        onClose={closeNetlifyModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-teal-500/5 border border-teal-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">What is Netlify Relay?</p>
            <p className="text-xs text-text-muted">
              Deploys a serverless relay function to Netlify&apos;s global edge network. All AI provider requests are forwarded through Netlify&apos;s edge, masking your real IP.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Runs on Netlify Functions with a 60-second execution limit and streaming support</li>
              <li>Free tier: 125,000 function invocations and 100GB bandwidth per month</li>
              <li>Relay URL format: https://your-site.netlify.app/.netlify/functions/relay</li>
              <li>Deploy multiple relays on different accounts for more IP diversity</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-teal-500/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate API token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>User Settings</b> → <b>Applications</b> → <b>Personal access tokens</b></li>
                <li>Select <b>New access token</b> and generate a token</li>
                <li>Copy the token — you won&apos;t see it again after leaving the page</li>
              </ol>
            </div>
          </div>
          <Input
            label="Netlify API Token"
            value={netlifyForm.netlifyToken}
            onChange={(e) => setNetlifyForm((prev) => ({ ...prev, netlifyToken: e.target.value }))}
            placeholder="nfp_xxxxxxxxxxxxxxxx"
            hint={<>Token is used once for deployment and not stored. <a href="https://app.netlify.com/user/applications#personal-access-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}
            type="password"
          />
          <Input
            label="Site Name"
            value={netlifyForm.projectName}
            onChange={(e) => setNetlifyForm((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="netlify-relay"
            hint="Unique site name (lowercase letters, numbers, hyphens). Your relay URL will be https://site-name.netlify.app/.netlify/functions/relay"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleNetlifyDeploy}
              disabled={!netlifyForm.netlifyToken.trim() || deploying}
            >
              {deploying ? "Deploying... (may take ~1 min)" : "Deploy"}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeNetlifyModal} disabled={deploying}>
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

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </PageShell>
  );
}
