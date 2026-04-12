"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const BULK_ACTION_LABELS = {
  test: "Test",
  activate: "Activate",
  deactivate: "Deactivate",
  delete: "Delete",
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

function normalizeUrlForSearch(value) {
  return (value || "").toLowerCase().trim();
}

function maskProxyUrl(proxyUrl) {
  if (!proxyUrl) return "";

  try {
    const parsed = new URL(proxyUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return proxyUrl;
  }
}

function compareValues(left, right, order = "asc") {
  const direction = order === "desc" ? -1 : 1;

  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * direction;
  }

  const leftValue = (left ?? "").toString().toLowerCase();
  const rightValue = (right ?? "").toString().toLowerCase();

  if (leftValue < rightValue) return -1 * direction;
  if (leftValue > rightValue) return 1 * direction;
  return 0;
}

function SortHeader({ label, field, sortBy, sortOrder, onSort }) {
  const isActive = sortBy === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="inline-flex items-center gap-1 hover:text-text-main transition-colors"
    >
      <span>{label}</span>
      <span className="text-[11px] opacity-70">
        {isActive ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

export default function ProxyPoolsPage() {
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortBy, setSortBy] = useState("updatedAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [bulkActionLoading, setBulkActionLoading] = useState("");
  const notify = useNotificationStore();

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      } else {
        notify.error(data.error || "Failed to fetch proxy pools");
      }
    } catch (error) {
      console.log("Error fetching proxy pools:", error);
      notify.error("Failed to fetch proxy pools");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchProxyPools();
  }, [fetchProxyPools]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => proxyPools.some((pool) => pool.id === id)));
  }, [proxyPools]);

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
    if (saving) return;
    setShowFormModal(false);
    resetForm();
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(field);
    setSortOrder(field === "name" ? "asc" : "desc");
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
      notify.error("Failed to save proxy pool");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool) => {
    const deleting = confirm(`Delete proxy pool "${proxyPool.name}"?`);
    if (!deleting) return;

    try {
      const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
      if (res.ok) {
        setProxyPools((prev) => prev.filter((item) => item.id !== proxyPool.id));
        setSelectedIds((prev) => prev.filter((id) => id !== proxyPool.id));
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

  const filteredAndSortedProxyPools = useMemo(() => {
    const query = normalizeUrlForSearch(search);
    const filtered = proxyPools.filter((pool) => {
      const matchesSearch = !query || [pool.name, pool.proxyUrl, pool.noProxy, pool.testStatus]
        .some((value) => normalizeUrlForSearch(value).includes(query));

      if (!matchesSearch) return false;

      if (statusFilter === "active") return pool.isActive === true;
      if (statusFilter === "inactive") return pool.isActive !== true;
      if (statusFilter === "healthy") return pool.testStatus === "active";
      if (statusFilter === "error") return pool.testStatus === "error";
      if (statusFilter === "in-use") return (pool.boundConnectionCount || 0) > 0;
      return true;
    });

    return [...filtered].sort((left, right) => {
      if (sortBy === "boundConnectionCount") {
        return compareValues(left.boundConnectionCount || 0, right.boundConnectionCount || 0, sortOrder);
      }

      if (sortBy === "lastTestedAt" || sortBy === "updatedAt") {
        return compareValues(
          new Date(left[sortBy] || 0).getTime(),
          new Date(right[sortBy] || 0).getTime(),
          sortOrder
        );
      }

      if (sortBy === "isActive") {
        return compareValues(left.isActive === true ? 1 : 0, right.isActive === true ? 1 : 0, sortOrder);
      }

      if (sortBy === "strictProxy") {
        return compareValues(left.strictProxy === true ? 1 : 0, right.strictProxy === true ? 1 : 0, sortOrder);
      }

      return compareValues(left[sortBy], right[sortBy], sortOrder);
    });
  }, [proxyPools, search, statusFilter, sortBy, sortOrder]);

  const selectedProxyPools = useMemo(
    () => filteredAndSortedProxyPools.filter((pool) => selectedIds.includes(pool.id)),
    [filteredAndSortedProxyPools, selectedIds]
  );

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools]
  );

  const healthyCount = useMemo(
    () => proxyPools.filter((pool) => pool.testStatus === "active").length,
    [proxyPools]
  );

  const visibleIds = filteredAndSortedProxyPools.map((pool) => pool.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedBoundCount = selectedProxyPools.filter((pool) => (pool.boundConnectionCount || 0) > 0).length;

  const toggleRowSelection = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id)
        ? prev.filter((value) => value !== id)
        : [...prev, id]
    ));
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
      return;
    }

    setSelectedIds((prev) => [...new Set([...prev, ...visibleIds])]);
  };

  const clearSelection = () => setSelectedIds([]);

  const handleBulkAction = async (action) => {
    if (selectedIds.length === 0 || bulkActionLoading) return;

    if (action === "delete") {
      const confirmed = confirm(
        selectedBoundCount > 0
          ? `Delete ${selectedIds.length} selected proxy pools? ${selectedBoundCount} item(s) are still bound and will be skipped.`
          : `Delete ${selectedIds.length} selected proxy pools?`
      );
      if (!confirmed) return;
    }

    setBulkActionLoading(action);
    try {
      const res = await fetch("/api/proxy-pools/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedIds }),
      });
      const data = await res.json();

      if (!res.ok) {
        notify.error(data.error || "Bulk action failed");
        return;
      }

      await fetchProxyPools();

      const blockedItems = (data.results || []).filter((item) => item.boundConnectionCount > 0);
      const failedItems = (data.results || []).filter((item) => !item.ok && !item.boundConnectionCount);

      if (blockedItems.length > 0) {
        notify.warning(`${BULK_ACTION_LABELS[action]} completed with ${blockedItems.length} blocked item(s).`);
      } else if (failedItems.length > 0) {
        notify.warning(`${BULK_ACTION_LABELS[action]} completed with ${failedItems.length} failed item(s).`);
      } else {
        notify.success(`${BULK_ACTION_LABELS[action]} completed for ${data.summary?.successCount || 0} proxy pool(s).`);
      }

      clearSelection();
    } catch (error) {
      console.log("Error running bulk proxy action:", error);
      notify.error("Bulk action failed");
    } finally {
      setBulkActionLoading("");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Proxy Pools</h1>
          <p className="text-sm text-text-muted mt-1">
            Manage reusable per-connection proxies and operate on multiple entries at once.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" icon="upload" onClick={openBatchImportModal}>
            Batch Import Proxies
          </Button>
          <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-sm text-text-muted">Total Proxy Pools</p>
          <p className="text-2xl font-semibold mt-1">{proxyPools.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-text-muted">Active at Runtime</p>
          <p className="text-2xl font-semibold mt-1">{activeCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-text-muted">Healthy on Last Test</p>
          <p className="text-2xl font-semibold mt-1">{healthyCount}</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border/50 flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[260px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, proxy URL, no_proxy, or status"
                icon="search"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "healthy", label: "Healthy" },
                { value: "error", label: "Error" },
                { value: "in-use", label: "In Use" },
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  className={`px-3 h-8 rounded-full text-xs font-medium border transition-colors ${
                    statusFilter === filter.value
                      ? "bg-primary text-white border-primary"
                      : "border-black/10 dark:border-white/10 text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="default">Visible: {filteredAndSortedProxyPools.length}</Badge>
              <Badge variant="success">Selected: {selectedIds.length}</Badge>
              {selectedBoundCount > 0 ? (
                <Badge variant="error">{selectedBoundCount} selected in use</Badge>
              ) : null}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="secondary"
                icon="science"
                onClick={() => handleBulkAction("test")}
                disabled={selectedIds.length === 0}
                loading={bulkActionLoading === "test"}
              >
                Test Selected
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="check_circle"
                onClick={() => handleBulkAction("activate")}
                disabled={selectedIds.length === 0}
                loading={bulkActionLoading === "activate"}
              >
                Activate
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="pause_circle"
                onClick={() => handleBulkAction("deactivate")}
                disabled={selectedIds.length === 0}
                loading={bulkActionLoading === "deactivate"}
              >
                Deactivate
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="delete"
                onClick={() => handleBulkAction("delete")}
                disabled={selectedIds.length === 0}
                loading={bulkActionLoading === "delete"}
              >
                Delete
              </Button>
              {selectedIds.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {filteredAndSortedProxyPools.length === 0 ? (
          <div className="text-center py-12 px-6">
            <p className="text-text-main font-medium mb-1">No proxy pools match the current view</p>
            <p className="text-sm text-text-muted mb-4">
              Try adjusting the search or filter, or create a new proxy pool.
            </p>
            <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle/40 text-text-muted border-b border-border/50">
                <tr>
                  <th className="px-4 py-3 text-left w-12">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-4 w-4 rounded border-black/20 dark:border-white/20"
                    />
                  </th>
                  <th className="px-4 py-3 text-left"><SortHeader label="Proxy" field="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th className="px-4 py-3 text-left"><SortHeader label="Status" field="testStatus" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th className="px-4 py-3 text-left"><SortHeader label="Runtime" field="isActive" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th className="px-4 py-3 text-left"><SortHeader label="Strict" field="strictProxy" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th className="px-4 py-3 text-left"><SortHeader label="Bound" field="boundConnectionCount" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th className="px-4 py-3 text-left"><SortHeader label="Last Tested" field="lastTestedAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th className="px-4 py-3 text-left"><SortHeader label="Updated" field="updatedAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} /></th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredAndSortedProxyPools.map((pool) => {
                  const isSelected = selectedIds.includes(pool.id);
                  const maskedUrl = maskProxyUrl(pool.proxyUrl);

                  return (
                    <tr
                      key={pool.id}
                      className={`${isSelected ? "bg-primary/5" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"} transition-colors`}
                    >
                      <td className="px-4 py-4 align-top">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelection(pool.id)}
                          className="h-4 w-4 rounded border-black/20 dark:border-white/20"
                        />
                      </td>
                      <td className="px-4 py-4 align-top min-w-[280px]">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-text-main">{pool.name}</span>
                            <Badge variant={getStatusVariant(pool.testStatus)} size="sm" dot>
                              {pool.testStatus || "unknown"}
                            </Badge>
                          </div>
                          <code className="text-xs text-text-muted bg-black/5 dark:bg-white/5 px-2 py-1 rounded w-fit">
                            {maskedUrl}
                          </code>
                          {pool.noProxy ? (
                            <p className="text-xs text-text-muted truncate" title={pool.noProxy}>
                              no_proxy: {pool.noProxy}
                            </p>
                          ) : (
                            <p className="text-xs text-text-muted">no_proxy: none</p>
                          )}
                          {pool.lastError ? (
                            <p className="text-xs text-red-500 truncate" title={pool.lastError}>
                              Last error: {pool.lastError}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <Badge variant={getStatusVariant(pool.testStatus)} size="sm">
                          {pool.testStatus || "unknown"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <Badge variant={pool.isActive ? "success" : "default"} size="sm">
                          {pool.isActive ? "active" : "inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <Badge variant={pool.strictProxy ? "error" : "default"} size="sm">
                          {pool.strictProxy ? "strict" : "fallback"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <Badge variant={(pool.boundConnectionCount || 0) > 0 ? "warning" : "default"} size="sm">
                          {pool.boundConnectionCount || 0}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 align-top text-text-muted">{formatDateTime(pool.lastTestedAt)}</td>
                      <td className="px-4 py-4 align-top text-text-muted">{formatDateTime(pool.updatedAt)}</td>
                      <td className="px-4 py-4 align-top">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleTest(pool.id)}
                            className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                            title="Test proxy"
                            disabled={testingId === pool.id}
                          >
                            <span
                              className={`material-symbols-outlined text-[18px] ${testingId === pool.id ? "animate-spin" : ""}`}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

          <div className="flex gap-2">
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

          <div className="rounded-lg border border-border/50 p-3 flex items-center justify-between">
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

          <div className="rounded-lg border border-border/50 p-3 flex items-center justify-between">
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

          <div className="flex gap-2">
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
