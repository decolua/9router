"use client";

import { useState, useEffect, useCallback } from "react";

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Badge({ running }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        running
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${running ? "bg-green-500" : "bg-gray-400"}`} />
      {running ? "Running" : "Stopped"}
    </span>
  );
}

// ─── Edit Modal (rename + port) ────────────────────────────────────────────────

function EditModal({ instance, onSave, onClose }) {
  const [name, setName] = useState(instance.name);
  const [port, setPort] = useState(String(instance.port));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const portNum = Number(port);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError("Port phải là số từ 1 đến 65535.");
      return;
    }
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), portNum);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Edit Instance</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={port}
              onChange={(e) => { setPort(e.target.value); setError(""); }}
              required
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Instance Modal ────────────────────────────────────────────────────────

function AddModal({ onSave, onClose }) {
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const portNum = Number(port);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError("Port phải là số từ 1 đến 65535.");
      return;
    }
    setSaving(true);
    try {
      const err = await onSave(name.trim() || `Instance`, portNum);
      if (err) setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">Add Instance</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              autoFocus
              placeholder="Ví dụ: GPT-4 Agent"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              placeholder="Ví dụ: 2041"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={port}
              onChange={(e) => { setPort(e.target.value); setError(""); }}
              required
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || !port}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Logs Modal ────────────────────────────────────────────────────────────────

function LogsModal({ instance, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/instances/${instance.id}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } finally {
      setLoading(false);
    }
  }, [instance.id]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl flex flex-col" style={{ maxHeight: "80vh" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Logs — {instance.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Port {instance.port}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchLogs} className="text-xs text-blue-500 hover:underline">Refresh</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <Spinner />
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No logs yet. Start the instance to see output.</p>
          ) : (
            <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all space-y-0.5">
              {logs.map((l, i) => (
                <div key={i}>
                  <span className="text-gray-400 mr-2 select-none">{l.ts.slice(11, 19)}</span>
                  {l.line}
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function InstancesPage() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingInstance, setEditingInstance] = useState(null);
  const [logsInstance, setLogsInstance] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchInstances = useCallback(async () => {
    try {
      const res = await fetch("/api/instances");
      if (res.ok) setInstances(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstances();
    const interval = setInterval(fetchInstances, 5000);
    return () => clearInterval(interval);
  }, [fetchInstances]);

  const setAction = (id, val) => setActionLoading((a) => ({ ...a, [id]: val }));

  const handleEdit = async (name, port) => {
    const res = await fetch(`/api/instances/${editingInstance.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, port }),
    });
    const json = await res.json();
    if (!res.ok) { showToast(json.error || "Failed to save", "error"); return; }
    setEditingInstance(null);
    showToast("Saved");
    fetchInstances();
  };

  const handleAdd = async (name, port) => {
    const res = await fetch("/api/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, port }),
    });
    const json = await res.json();
    if (!res.ok) return json.error || "Failed to add";
    setShowAddModal(false);
    showToast(`Added instance on port ${port}`);
    fetchInstances();
    return null;
  };

  const handleDelete = async (inst) => {
    if (!confirm(`Xóa instance "${inst.name}" (port ${inst.port})?`)) return;
    const res = await fetch(`/api/instances/${inst.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { showToast(json.error || "Failed to delete", "error"); return; }
    showToast("Deleted");
    fetchInstances();
  };

  const handleStart = async (id, port) => {
    setAction(id, "starting");
    try {
      const res = await fetch(`/api/instances/${id}/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { showToast(json.error || "Failed to start", "error"); return; }
      showToast(`Started on port ${port}`);
      fetchInstances();
    } finally {
      setAction(id, null);
    }
  };

  const handleStop = async (id) => {
    setAction(id, "stopping");
    try {
      const res = await fetch(`/api/instances/${id}/stop`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) { showToast(json.error || "Failed to stop", "error"); return; }
      showToast("Instance stopped");
      fetchInstances();
    } finally {
      setAction(id, null);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Instances</h1>
          <p className="text-sm text-gray-500 mt-1">
            {instances.length} gateway độc lập. Đặt tên để ghi nhớ API key hoặc tài khoản được gán.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-base">add</span>
          Add Instance
        </button>
      </div>

      {/* List */}
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          {instances.map((inst) => (
            <div
              key={inst.id}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-5 py-3.5 flex items-center gap-4"
            >
              {/* Port badge */}
              <div className="shrink-0 w-16 text-center">
                <span className="text-xs font-mono font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  :{inst.port}
                </span>
              </div>

              {/* Name + status */}
              <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900 dark:text-white truncate">{inst.name}</span>
                <Badge running={inst.running} />
              </div>

              {/* Endpoint link (only when running) */}
              {inst.running && (
                <a
                  href={`http://localhost:${inst.port}/dashboard`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs text-blue-500 hover:underline hidden sm:block"
                >
                  Open ↗
                </a>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditingInstance(inst)}
                  title="Edit name & port"
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                </button>
                <button
                  onClick={() => setLogsInstance(inst)}
                  title="View logs"
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">terminal</span>
                </button>
                <button
                  onClick={() => handleDelete(inst)}
                  disabled={inst.running}
                  title={inst.running ? "Stop instance before deleting" : "Delete instance"}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>

                {inst.running ? (
                  <button
                    onClick={() => handleStop(inst.id)}
                    disabled={actionLoading[inst.id] === "stopping"}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading[inst.id] === "stopping" ? "Stopping…" : "Stop"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleStart(inst.id, inst.port)}
                    disabled={actionLoading[inst.id] === "starting"}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 text-green-600 dark:text-green-400 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading[inst.id] === "starting" ? "Starting…" : "Start"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div className="mt-6 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
        <p className="font-medium mb-1">Cách sử dụng</p>
        <p>Mỗi instance chạy độc lập với providers, combos và API key riêng. Sau khi Start, mở dashboard tại <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">http://localhost:PORT/dashboard</code> để cấu hình, rồi trỏ Agent vào <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">http://localhost:PORT/v1</code>.</p>
      </div>

      {/* Modals */}
      {editingInstance && (
        <EditModal instance={editingInstance} onSave={handleEdit} onClose={() => setEditingInstance(null)} />
      )}
      {showAddModal && (
        <AddModal onSave={handleAdd} onClose={() => setShowAddModal(false)} />
      )}
      {logsInstance && (
        <LogsModal instance={logsInstance} onClose={() => setLogsInstance(null)} />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
            toast.type === "error" ? "bg-red-600" : "bg-green-600"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
