"use client";

import { useState, useEffect } from "react";
import { Card, Button, Badge, Toggle, Input, ProxyConfigModal } from "@/shared/components";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";

export default function ProfilePage() {
  const { theme, setTheme, isDark } = useTheme();
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);
  
  // Combo defaults state
  const [comboDefaults, setComboDefaults] = useState({
    strategy: "priority",
    maxRetries: 1,
    retryDelayMs: 2000,
    timeoutMs: 120000,
    healthCheckEnabled: true,
    healthCheckTimeoutMs: 3000,
    maxComboDepth: 3,
    trackMetrics: true,
  });
  const [providerOverrides, setProviderOverrides] = useState({});
  const [newOverrideProvider, setNewOverrideProvider] = useState("");
  const [comboDefaultsSaving, setComboDefaultsSaving] = useState(false);

  // Backup/Restore state
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsExpanded, setBackupsExpanded] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState({ type: "", message: "" });
  const [restoringId, setRestoringId] = useState(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState(null);
  const [manualBackupLoading, setManualBackupLoading] = useState(false);
  const [manualBackupStatus, setManualBackupStatus] = useState({ type: "", message: "" });
  const [storageHealth, setStorageHealth] = useState({
    driver: "sqlite",
    dbPath: "~/.9router/storage.sqlite",
    sizeBytes: 0,
    retentionDays: 90,
    lastBackupAt: null,
  });

  // Global Proxy state
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [globalProxy, setGlobalProxy] = useState(null);

  const loadGlobalProxy = async () => {
    try {
      const res = await fetch("/api/settings/proxy?level=global");
      if (res.ok) {
        const data = await res.json();
        setGlobalProxy(data.proxy || null);
      }
    } catch {}
  };

  const loadBackups = async () => {
    setBackupsLoading(true);
    try {
      const res = await fetch("/api/db-backups");
      const data = await res.json();
      setBackups(data.backups || []);
    } catch (err) {
      console.error("Failed to fetch backups:", err);
    } finally {
      setBackupsLoading(false);
    }
  };

  const loadStorageHealth = async () => {
    try {
      const res = await fetch("/api/storage/health");
      if (!res.ok) return;
      const data = await res.json();
      setStorageHealth((prev) => ({ ...prev, ...data }));
    } catch (err) {
      console.error("Failed to fetch storage health:", err);
    }
  };

  const handleManualBackup = async () => {
    setManualBackupLoading(true);
    setManualBackupStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/db-backups", { method: "PUT" });
      const data = await res.json();
      if (res.ok) {
        if (data.filename) {
          setManualBackupStatus({ type: "success", message: `Backup created: ${data.filename}` });
        } else {
          setManualBackupStatus({ type: "info", message: data.message || "No changes since last backup" });
        }
        await loadStorageHealth();
        if (backupsExpanded) await loadBackups();
      } else {
        setManualBackupStatus({ type: "error", message: data.error || "Backup failed" });
      }
    } catch (err) {
      setManualBackupStatus({ type: "error", message: "An error occurred" });
    } finally {
      setManualBackupLoading(false);
    }
  };

  const handleRestore = async (backupId) => {
    setRestoringId(backupId);
    setRestoreStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/db-backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupId }),
      });
      const data = await res.json();
      if (res.ok) {
        setRestoreStatus({
          type: "success",
          message: `Restored! ${data.connectionCount} connections, ${data.nodeCount} nodes, ${data.comboCount} combos, ${data.apiKeyCount} API keys.`,
        });
        // Refresh backups list
        await loadBackups();
        await loadStorageHealth();
      } else {
        setRestoreStatus({ type: "error", message: data.error || "Restore failed" });
      }
    } catch (err) {
      setRestoreStatus({ type: "error", message: "An error occurred during restore" });
    } finally {
      setRestoringId(null);
      setConfirmRestoreId(null);
    }
  };

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch settings:", err);
        setLoading(false);
      });

    // Load global proxy config for status display
    loadGlobalProxy();
    loadStorageHealth();

    // Fetch combo defaults
    fetch("/api/settings/combo-defaults")
      .then((res) => res.json())
      .then((data) => {
        if (data.comboDefaults) setComboDefaults(data.comboDefaults);
        if (data.providerOverrides) setProviderOverrides(data.providerOverrides);
      })
      .catch((err) => console.error("Failed to fetch combo defaults:", err));
  }, []);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setPassStatus({ type: "success", message: "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({ type: "error", message: data.error || "Failed to update password" });
      }
    } catch (err) {
      setPassStatus({ type: "error", message: "An error occurred" });
    } finally {
      setPassLoading(false);
    }
  };

  const updateFallbackStrategy = async (strategy) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallbackStrategy: strategy }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update settings:", err);
    }
  };

  const updateStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Failed to update sticky limit:", err);
    }
  };

  const updateRequireLogin = async (requireLogin) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
    }
  };

  const saveComboDefaults = async () => {
    setComboDefaultsSaving(true);
    try {
      const res = await fetch("/api/settings/combo-defaults", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboDefaults, providerOverrides }),
      });
      if (!res.ok) console.error("Failed to save combo defaults");
    } catch (err) {
      console.error("Failed to save combo defaults:", err);
    } finally {
      setComboDefaultsSaving(false);
    }
  };

  const addProviderOverride = () => {
    const name = newOverrideProvider.trim().toLowerCase();
    if (!name || providerOverrides[name]) return;
    setProviderOverrides(prev => ({ ...prev, [name]: { maxRetries: 1, timeoutMs: 120000 } }));
    setNewOverrideProvider("");
  };

  const removeProviderOverride = (provider) => {
    setProviderOverrides(prev => {
      const copy = { ...prev };
      delete copy[provider];
      return copy;
    });
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatRelativeTime = (isoString) => {
    if (!isoString) return null;
    const now = new Date();
    const then = new Date(isoString);
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-col gap-6">

        {/* ═══════ 1. System & Storage ═══════ */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
              <span className="material-symbols-outlined text-[20px]">database</span>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">System & Storage</h3>
              <p className="text-xs text-text-muted">All data stored locally on your machine</p>
            </div>
            <Badge variant={storageHealth.driver === "sqlite" ? "success" : "default"} size="sm">
              {storageHealth.driver || "json"}
            </Badge>
          </div>

          {/* Storage info grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-bg border border-border">
              <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1">Database Path</p>
              <p className="text-sm font-mono text-text-main break-all">{storageHealth.dbPath || "~/.9router/storage.sqlite"}</p>
            </div>
            <div className="p-3 rounded-lg bg-bg border border-border">
              <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1">Database Size</p>
              <p className="text-sm font-mono text-text-main">{formatBytes(storageHealth.sizeBytes)}</p>
            </div>
          </div>

          {/* Last backup + Backup Now row */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-bg border border-border mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-amber-500">schedule</span>
              <div>
                <p className="text-sm font-medium">Last Backup</p>
                <p className="text-xs text-text-muted">
                  {storageHealth.lastBackupAt
                    ? `${new Date(storageHealth.lastBackupAt).toLocaleString("pt-BR")} (${formatRelativeTime(storageHealth.lastBackupAt)})`
                    : "No backup yet"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualBackup}
              loading={manualBackupLoading}
            >
              <span className="material-symbols-outlined text-[14px] mr-1">backup</span>
              Backup Now
            </Button>
          </div>

          {manualBackupStatus.message && (
            <div className={`p-3 rounded-lg mb-4 text-sm ${
              manualBackupStatus.type === "success"
                ? "bg-green-500/10 text-green-500 border border-green-500/20"
                : manualBackupStatus.type === "info"
                ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                : "bg-red-500/10 text-red-500 border border-red-500/20"
            }`}>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">
                  {manualBackupStatus.type === "success" ? "check_circle" : manualBackupStatus.type === "info" ? "info" : "error"}
                </span>
                {manualBackupStatus.message}
              </div>
            </div>
          )}

          {/* Backup/Restore expandable section */}
          <div className="pt-3 border-t border-border/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-amber-500">restore</span>
                <p className="font-medium">Backup & Restore</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBackupsExpanded(!backupsExpanded);
                  if (!backupsExpanded && backups.length === 0) loadBackups();
                }}
              >
                {backupsExpanded ? "Hide" : "View Backups"}
              </Button>
            </div>
            <p className="text-xs text-text-muted mb-3">
              SQLite snapshots are created automatically before restore and every 15 minutes when data changes.
              Retention: 24 hourly + 30 daily backups with smart rotation.
            </p>

            {restoreStatus.message && (
              <div className={`p-3 rounded-lg mb-3 text-sm ${
                restoreStatus.type === "success"
                  ? "bg-green-500/10 text-green-500 border border-green-500/20"
                  : "bg-red-500/10 text-red-500 border border-red-500/20"
              }`}>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">
                    {restoreStatus.type === "success" ? "check_circle" : "error"}
                  </span>
                  {restoreStatus.message}
                </div>
              </div>
            )}

            {backupsExpanded && (
              <div className="flex flex-col gap-2">
                {backupsLoading ? (
                  <div className="flex items-center justify-center py-6 text-text-muted">
                    <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
                    Loading backups...
                  </div>
                ) : backups.length === 0 ? (
                  <div className="text-center py-6 text-text-muted text-sm">
                    <span className="material-symbols-outlined text-[32px] mb-2 block opacity-40">folder_off</span>
                    No backups available yet. Backups will be created automatically when data changes.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-text-muted">{backups.length} backup(s) available</span>
                      <button
                        onClick={loadBackups}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">refresh</span>
                        Refresh
                      </button>
                    </div>
                    {backups.map((backup) => (
                      <div
                        key={backup.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-border/50 hover:border-border transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="material-symbols-outlined text-[16px] text-amber-500">description</span>
                            <span className="text-sm font-medium truncate">
                              {new Date(backup.createdAt).toLocaleString("pt-BR")}
                            </span>
                            <Badge variant={backup.reason === "pre-restore" ? "warning" : backup.reason === "manual" ? "success" : "default"} size="sm">
                              {backup.reason}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-text-muted ml-6">
                            <span>{backup.connectionCount} connection(s)</span>
                            <span>•</span>
                            <span>{formatBytes(backup.size)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-3">
                          {confirmRestoreId === backup.id ? (
                            <>
                              <span className="text-xs text-amber-500 font-medium">Confirm?</span>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleRestore(backup.id)}
                                loading={restoringId === backup.id}
                                className="!bg-amber-500 hover:!bg-amber-600"
                              >
                                Yes
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmRestoreId(null)}
                              >
                                No
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmRestoreId(backup.id)}
                            >
                              <span className="material-symbols-outlined text-[14px] mr-1">restore</span>
                              Restore
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ═══════ 2. Security ═══════ */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[20px]">shield</span>
            </div>
            <h3 className="text-lg font-semibold">Security</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Require login</p>
                <p className="text-sm text-text-muted">
                  When ON, dashboard requires password. When OFF, access without login.
                </p>
              </div>
              <Toggle
                checked={settings.requireLogin === true}
                onChange={() => updateRequireLogin(!settings.requireLogin)}
                disabled={loading}
              />
            </div>
            {settings.requireLogin === true && (
              <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 pt-4 border-t border-border/50">
                {settings.hasPassword && (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Current Password</label>
                    <Input
                      type="password"
                      placeholder="Enter current password"
                      value={passwords.current}
                      onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                      required
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">New Password</label>
                    <Input
                      type="password"
                      placeholder="Enter new password"
                      value={passwords.new}
                      onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Confirm New Password</label>
                    <Input
                      type="password"
                      placeholder="Confirm new password"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {passStatus.message && (
                  <p className={`text-sm ${passStatus.type === "error" ? "text-red-500" : "text-green-500"}`}>
                    {passStatus.message}
                  </p>
                )}

                <div className="pt-2">
                  <Button type="submit" variant="primary" loading={passLoading}>
                    {settings.hasPassword ? "Update Password" : "Set Password"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Card>

        {/* ═══════ 3. Routing Strategy ═══════ */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <span className="material-symbols-outlined text-[20px]">route</span>
            </div>
            <h3 className="text-lg font-semibold">Routing Strategy</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Round Robin</p>
                <p className="text-sm text-text-muted">
                  Cycle through accounts to distribute load
                </p>
              </div>
              <Toggle
                checked={settings.fallbackStrategy === "round-robin"}
                onChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")}
                disabled={loading}
              />
            </div>

            {/* Sticky Round Robin Limit */}
            {settings.fallbackStrategy === "round-robin" && (
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div>
                  <p className="font-medium">Sticky Limit</p>
                  <p className="text-sm text-text-muted">
                    Calls per account before switching
                  </p>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.stickyRoundRobinLimit || 3}
                  onChange={(e) => updateStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-20 text-center"
                />
              </div>
            )}

            <p className="text-xs text-text-muted italic pt-2 border-t border-border/50">
              {settings.fallbackStrategy === "round-robin"
                ? `Currently distributing requests across all available accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
                : "Currently using accounts in priority order (Fill First)."}
            </p>
          </div>
        </Card>

        {/* ═══════ 4. Combo Defaults ═══════ */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <span className="material-symbols-outlined text-[20px]">tune</span>
            </div>
            <h3 className="text-lg font-semibold">Combo Defaults</h3>
            <span className="text-xs text-text-muted ml-auto">Global combo configuration</span>
          </div>
          <div className="flex flex-col gap-4">
            {/* Default Strategy */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Default Strategy</p>
                <p className="text-xs text-text-muted">Applied to new combos without explicit strategy</p>
              </div>
              <div className="inline-flex p-0.5 rounded-md bg-black/5 dark:bg-white/5">
                {["priority", "weighted", "round-robin"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setComboDefaults(prev => ({ ...prev, strategy: s }))}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-medium transition-all capitalize",
                      comboDefaults.strategy === s
                        ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    )}
                  >
                    {s === "round-robin" ? "Round-Robin" : s}
                  </button>
                ))}
              </div>
            </div>

            {/* Numeric settings */}
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/50">
              {[
                { key: "maxRetries", label: "Max Retries", min: 0, max: 5 },
                { key: "retryDelayMs", label: "Retry Delay (ms)", min: 500, max: 10000, step: 500 },
                { key: "timeoutMs", label: "Timeout (ms)", min: 5000, max: 300000, step: 5000 },
                { key: "maxComboDepth", label: "Max Nesting Depth", min: 1, max: 10 },
              ].map(({ key, label, min, max, step }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-muted">{label}</label>
                  <Input
                    type="number"
                    min={min}
                    max={max}
                    step={step || 1}
                    value={comboDefaults[key] ?? ""}
                    onChange={(e) => setComboDefaults(prev => ({ ...prev, [key]: parseInt(e.target.value) || 0 }))}
                    className="text-sm"
                  />
                </div>
              ))}
            </div>

            {/* Round-Robin specific settings */}
            {comboDefaults.strategy === "round-robin" && (
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/50">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-muted">Concurrency / Model</label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={comboDefaults.concurrencyPerModel ?? ""}
                    placeholder="3"
                    onChange={(e) => setComboDefaults(prev => ({ ...prev, concurrencyPerModel: parseInt(e.target.value) || 0 }))}
                    className="text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-text-muted">Queue Timeout (ms)</label>
                  <Input
                    type="number"
                    min={1000}
                    max={120000}
                    step={1000}
                    value={comboDefaults.queueTimeoutMs ?? ""}
                    placeholder="30000"
                    onChange={(e) => setComboDefaults(prev => ({ ...prev, queueTimeoutMs: parseInt(e.target.value) || 0 }))}
                    className="text-sm"
                  />
                </div>
              </div>
            )}

            {/* Toggles */}
            <div className="flex flex-col gap-3 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Health Check</p>
                  <p className="text-xs text-text-muted">Pre-check provider availability</p>
                </div>
                <Toggle
                  checked={comboDefaults.healthCheckEnabled !== false}
                  onChange={() => setComboDefaults(prev => ({ ...prev, healthCheckEnabled: !prev.healthCheckEnabled }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Track Metrics</p>
                  <p className="text-xs text-text-muted">Record per-combo request metrics</p>
                </div>
                <Toggle
                  checked={comboDefaults.trackMetrics !== false}
                  onChange={() => setComboDefaults(prev => ({ ...prev, trackMetrics: !prev.trackMetrics }))}
                />
              </div>
            </div>

            {/* Provider Overrides */}
            <div className="pt-3 border-t border-border/50">
              <p className="font-medium text-sm mb-2">Provider Overrides</p>
              <p className="text-xs text-text-muted mb-3">Override timeout and retries per provider. Provider settings override global defaults.</p>

              {Object.entries(providerOverrides).map(([provider, config]) => (
                <div key={provider} className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.02]">
                  <span className="text-xs font-mono font-medium min-w-[80px]">{provider}</span>
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    value={config.maxRetries ?? 1}
                    onChange={(e) => setProviderOverrides(prev => ({
                      ...prev,
                      [provider]: { ...prev[provider], maxRetries: parseInt(e.target.value) || 0 }
                    }))}
                    className="text-xs w-16"
                    title="Max Retries"
                  />
                  <span className="text-[10px] text-text-muted">retries</span>
                  <Input
                    type="number"
                    min="5000"
                    max="300000"
                    step="5000"
                    value={config.timeoutMs ?? 120000}
                    onChange={(e) => setProviderOverrides(prev => ({
                      ...prev,
                      [provider]: { ...prev[provider], timeoutMs: parseInt(e.target.value) || 120000 }
                    }))}
                    className="text-xs w-24"
                    title="Timeout (ms)"
                  />
                  <span className="text-[10px] text-text-muted">ms</span>
                  <button
                    onClick={() => removeProviderOverride(provider)}
                    className="ml-auto text-red-400 hover:text-red-500 transition-colors"
                    title="Remove override"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-2 mt-2">
                <Input
                  type="text"
                  placeholder="e.g. google, openai..."
                  value={newOverrideProvider}
                  onChange={(e) => setNewOverrideProvider(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addProviderOverride()}
                  className="text-xs flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addProviderOverride}
                  disabled={!newOverrideProvider.trim()}
                >
                  Add
                </Button>
              </div>
            </div>

            {/* Save button */}
            <div className="pt-3 border-t border-border/50">
              <Button variant="primary" size="sm" onClick={saveComboDefaults} loading={comboDefaultsSaving}>
                Save Combo Defaults
              </Button>
            </div>
          </div>
        </Card>

        {/* ═══════ 5. Global Proxy ═══════ */}
        <Card className="p-0 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-xl text-primary">vpn_lock</span>
              <h2 className="text-lg font-bold">Global Proxy</h2>
            </div>
            <p className="text-sm text-text-muted mb-4">
              Configure a global outbound proxy for all API calls. Individual providers, combos, and keys can override this.
            </p>
            <div className="flex items-center gap-3">
              {globalProxy ? (
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded text-xs font-bold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {globalProxy.type}://{globalProxy.host}:{globalProxy.port}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-text-muted">No global proxy configured</span>
              )}
              <Button
                size="sm"
                variant={globalProxy ? "secondary" : "primary"}
                icon="settings"
                onClick={() => { loadGlobalProxy(); setProxyModalOpen(true); }}
              >
                {globalProxy ? "Edit" : "Configure"}
              </Button>
            </div>
          </div>
        </Card>

        <ProxyConfigModal
          isOpen={proxyModalOpen}
          onClose={() => setProxyModalOpen(false)}
          level="global"
          levelLabel="Global"
          onSaved={loadGlobalProxy}
        />

        {/* ═══════ 6. Appearance ═══════ */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <span className="material-symbols-outlined text-[20px]">palette</span>
            </div>
            <h3 className="text-lg font-semibold">Appearance</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Dark Mode</p>
                <p className="text-sm text-text-muted">
                  Switch between light and dark themes
                </p>
              </div>
              <Toggle
                checked={isDark}
                onChange={() => setTheme(isDark ? "light" : "dark")}
              />
            </div>

            {/* Theme Options */}
            <div className="pt-4 border-t border-border">
              <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5">
                {["light", "dark", "system"].map((option) => (
                  <button
                    key={option}
                    onClick={() => setTheme(option)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all",
                      theme === option
                        ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    )}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {option === "light" ? "light_mode" : option === "dark" ? "dark_mode" : "contrast"}
                    </span>
                    <span className="capitalize">{option}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* App Info */}
        <div className="text-center text-sm text-text-muted py-4">
          <p>{APP_CONFIG.name} v{APP_CONFIG.version}</p>
          <p className="mt-1">Local Mode — All data stored on your machine</p>
        </div>
      </div>
    </div>
  );
}
