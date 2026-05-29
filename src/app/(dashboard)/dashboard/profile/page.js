"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, Toggle, Input, SegmentedControl } from "@/shared/components";
import { StatusAlert } from "../endpoint/components/StatusAlert";
import { useTheme } from "@/shared/hooks/useTheme";
import { APP_CONFIG } from "@/shared/constants/config";

const EMPTY_STATUS = { type: "", message: "" };
const DEFAULT_OIDC_FORM = {
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
};
const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "contrast" },
];
const OIDC_AUTH_MODE_OPTIONS = [
  {
    value: "password",
    title: "Password only",
    desc: "Keep the legacy password login.",
  },
  {
    value: "oidc",
    title: "OIDC only",
    desc: "Require OIDC for dashboard access.",
  },
  {
    value: "both",
    title: "Both",
    desc: "Allow either password or OIDC.",
  },
];

function getOidcFormFromSettings(data = {}, fallback = DEFAULT_OIDC_FORM) {
  return {
    authMode: data?.authMode || fallback.authMode,
    oidcIssuerUrl: data?.oidcIssuerUrl || fallback.oidcIssuerUrl,
    oidcClientId: data?.oidcClientId || fallback.oidcClientId,
    oidcScopes: data?.oidcScopes || fallback.oidcScopes,
    oidcLoginLabel: data?.oidcLoginLabel || fallback.oidcLoginLabel,
  };
}

function ProfileStatus({ status, className = "" }) {
  if (!status.message) return null;
  return <StatusAlert status={status} className={className} />;
}

export default function ProfilePage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });
  const [passStatus, setPassStatus] = useState(EMPTY_STATUS);
  const [passLoading, setPassLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState(EMPTY_STATUS);
  const [includeUsageAnalytics, setIncludeUsageAnalytics] = useState(false);
  const [restoreUsageAnalytics, setRestoreUsageAnalytics] = useState(false);
  const [oidcForm, setOidcForm] = useState(DEFAULT_OIDC_FORM);
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcStatus, setOidcStatus] = useState(EMPTY_STATUS);
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcTestLoading, setOidcTestLoading] = useState(false);
  const [oidcTestStatus, setOidcTestStatus] = useState(EMPTY_STATUS);
  const [oidcRedirectUri] = useState(() => {
    if (typeof window === "undefined") {
      return "/api/auth/oidc/callback";
    }

    return `${window.location.origin}/api/auth/oidc/callback`;
  });
  const [oidcExpanded, setOidcExpanded] = useState(false);
  const importFileRef = useRef(null);
  const [proxyForm, setProxyForm] = useState({
    outboundProxyUrl: "",
    outboundNoProxy: "",
  });
  const [proxyStatus, setProxyStatus] = useState(EMPTY_STATUS);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings(data);
        setOidcForm(getOidcFormFromSettings(data));
        setOidcClientSecret("");
        if (data?.authMode === "oidc" || data?.authMode === "both")
          setOidcExpanded(true);
        setProxyForm({
          outboundProxyUrl: data?.outboundProxyUrl || "",
          outboundNoProxy: data?.outboundNoProxy || "",
        });
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch settings:", err);
        setLoading(false);
      });
  }, []);

  const updateOutboundProxy = async (e) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus(EMPTY_STATUS);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProxyUrl: proxyForm.outboundProxyUrl,
          outboundNoProxy: proxyForm.outboundNoProxy,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyStatus({ type: "success", message: "Proxy settings applied" });
      } else {
        setProxyStatus({
          type: "error",
          message: data.error || "Failed to update proxy settings",
        });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;

    const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
    if (!proxyUrl) {
      setProxyStatus({
        type: "error",
        message: "Please enter a Proxy URL to test",
      });
      return;
    }

    setProxyTestLoading(true);
    setProxyStatus(EMPTY_STATUS);

    try {
      const res = await fetch("/api/settings/proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl }),
      });

      const data = await res.json();
      if (res.ok && data?.ok) {
        setProxyStatus({
          type: "success",
          message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms`,
        });
      } else {
        setProxyStatus({
          type: "error",
          message: data?.error || "Proxy test failed",
        });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled) => {
    setProxyLoading(true);
    setProxyStatus(EMPTY_STATUS);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundProxyEnabled }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyStatus({
          type: "success",
          message: outboundProxyEnabled ? "Proxy enabled" : "Proxy disabled",
        });
      } else {
        setProxyStatus({
          type: "error",
          message: data.error || "Failed to update proxy settings",
        });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus(EMPTY_STATUS);

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
        setPassStatus({
          type: "success",
          message: "Password updated successfully",
        });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({
          type: "error",
          message: data.error || "Failed to update password",
        });
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
        setSettings((prev) => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update settings:", err);
    }
  };

  const updateComboStrategy = async (strategy) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategy: strategy }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, comboStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update combo strategy:", err);
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
        setSettings((prev) => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Failed to update sticky limit:", err);
    }
  };

  const updateComboStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings((prev) => ({
          ...prev,
          comboStickyRoundRobinLimit: numLimit,
        }));
      }
    } catch (err) {
      console.error("Failed to update combo sticky limit:", err);
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
        setSettings((prev) => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
    }
  };

  const updateOidcForm = (field, value) => {
    setOidcForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateProxyForm = (field, value) => {
    setProxyForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveOidcSettings = async (
    authMode = oidcForm.authMode || DEFAULT_OIDC_FORM.authMode,
  ) => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const loginLabel = oidcForm.oidcLoginLabel.trim();
    const secret = oidcClientSecret.trim();

    if (
      authMode !== "password" &&
      (!issuerUrl || !clientId || !secret) &&
      !settings.oidcConfigured
    ) {
      setOidcStatus({
        type: "error",
        message:
          "Issuer URL, client ID, and client secret are required to enable OIDC.",
      });
      return;
    }

    setOidcLoading(true);
    setOidcStatus(EMPTY_STATUS);
    setOidcTestStatus(EMPTY_STATUS);

    try {
      const payload = {
        authMode,
        oidcIssuerUrl: issuerUrl,
        oidcClientId: clientId,
        oidcScopes: scopes || DEFAULT_OIDC_FORM.oidcScopes,
        oidcLoginLabel: loginLabel || DEFAULT_OIDC_FORM.oidcLoginLabel,
      };
      if (secret) {
        payload.oidcClientSecret = secret;
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setOidcForm(
          getOidcFormFromSettings(data, {
            authMode,
            oidcIssuerUrl: issuerUrl,
            oidcClientId: clientId,
            oidcScopes: scopes || DEFAULT_OIDC_FORM.oidcScopes,
            oidcLoginLabel: loginLabel || DEFAULT_OIDC_FORM.oidcLoginLabel,
          }),
        );
        setOidcClientSecret("");
        setOidcStatus({
          type: "success",
          message:
            authMode === "oidc"
              ? "OIDC login enabled"
              : authMode === "both"
                ? "Password and OIDC login enabled"
                : "OIDC settings saved",
        });
      } else {
        setOidcStatus({
          type: "error",
          message: data.error || "Failed to save OIDC settings",
        });
      }
    } catch (err) {
      setOidcStatus({ type: "error", message: "An error occurred" });
    } finally {
      setOidcLoading(false);
    }
  };

  const testOidcConnection = async () => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const secret = oidcClientSecret.trim();

    if (!issuerUrl || !clientId) {
      setOidcTestStatus({
        type: "error",
        message:
          "Issuer URL and client ID are required to test the connection.",
      });
      return;
    }

    setOidcTestLoading(true);
    setOidcStatus(EMPTY_STATUS);
    setOidcTestStatus(EMPTY_STATUS);

    try {
      const saveRes = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authMode: oidcForm.authMode || settings.authMode || "password",
          oidcIssuerUrl: issuerUrl,
          oidcClientId: clientId,
          oidcScopes: scopes || "openid profile email",
          oidcLoginLabel: oidcForm.oidcLoginLabel.trim() || "Sign in with OIDC",
          ...(secret ? { oidcClientSecret: secret } : {}),
        }),
      });

      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        setOidcTestStatus({
          type: "error",
          message: saved.error || "Failed to save OIDC settings before testing",
        });
        return;
      }

      const res = await fetch("/api/auth/oidc/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuerUrl: saved.oidcIssuerUrl || issuerUrl,
          clientId: saved.oidcClientId || clientId,
          scopes: saved.oidcScopes || scopes || "openid profile email",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        const statusMessage = data.clientSecretTested
          ? data.clientSecretValid === true
            ? `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret validated too.`
            : `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret was not checked.`
          : `Connection OK. Discovery loaded from ${data.issuerUrl}.`;
        setOidcTestStatus({
          type: "success",
          message: statusMessage,
        });
      } else {
        setOidcTestStatus({
          type: "error",
          message: data.error || "OIDC connection test failed",
        });
      }
    } catch (err) {
      setOidcTestStatus({ type: "error", message: "An error occurred" });
    } finally {
      setOidcTestLoading(false);
    }
  };

  const updateObservabilityEnabled = async (enabled) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableObservability: enabled }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, enableObservability: enabled }));
      }
    } catch (err) {
      console.error("Failed to update enableObservability:", err);
    }
  };

  const reloadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Failed to reload settings:", err);
    }
  };

  const handleExportDatabase = async () => {
    setDbLoading(true);
    setDbStatus(EMPTY_STATUS);
    try {
      const params = new URLSearchParams();
      if (includeUsageAnalytics) {
        params.set("includeUsageAnalytics", "true");
      }
      const query = params.toString();
      const res = await fetch(
        `/api/settings/database${query ? `?${query}` : ""}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to export database");
      }

      const payload = await res.json();
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      anchor.href = url;
      anchor.download = `9router-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setDbStatus({ type: "success", message: "Database backup downloaded" });
    } catch (err) {
      setDbStatus({
        type: "error",
        message: err.message || "Failed to export database",
      });
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setDbLoading(true);
    setDbStatus(EMPTY_STATUS);

    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);
      const analyticsIncluded = !!payload?.usageAnalytics;
      const shouldRestoreUsageAnalytics =
        analyticsIncluded && restoreUsageAnalytics;

      const res = await fetch("/api/settings/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          restoreUsageAnalytics: shouldRestoreUsageAnalytics,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to import database");
      }

      await reloadSettings();
      setDbStatus({
        type: "success",
        message:
          analyticsIncluded && !shouldRestoreUsageAnalytics
            ? "Database imported successfully. Usage & Analytics skipped."
            : "Database imported successfully",
      });
    } catch (err) {
      setDbStatus({
        type: "error",
        message: err.message || "Invalid backup file",
      });
    } finally {
      if (importFileRef.current) {
        importFileRef.current.value = "";
      }
      setDbLoading(false);
    }
  };

  const observabilityEnabled = settings.enableObservability === true;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-0">
      <div className="flex flex-col gap-6">
        {/* Local Mode Info */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="size-10 sm:size-12 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-xl sm:text-2xl">
                  computer
                </span>
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-semibold">Local Mode</h2>
                <p className="text-sm text-text-muted">
                  Running on your machine
                </p>
              </div>
            </div>
            <SegmentedControl
              options={THEME_OPTIONS}
              value={theme}
              onChange={setTheme}
              size="sm"
              className="w-full sm:w-auto"
            />
          </div>
          <div className="flex flex-col gap-3 pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg bg-bg border border-border gap-2">
              <div>
                <p className="font-medium text-sm sm:text-base">
                  Database Location
                </p>
                <p className="text-xs sm:text-sm text-text-muted font-mono break-all">
                  ~/.9router/db/data.sqlite
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-start sm:items-center justify-between gap-4 rounded-lg border border-border bg-bg p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm sm:text-base">
                    Include Usage & Analytics
                  </p>
                  <p className="text-xs sm:text-sm text-text-muted">
                    Add token, cost, request history, and request details to the
                    downloaded backup.
                  </p>
                </div>
                <Toggle
                  checked={includeUsageAnalytics}
                  onChange={() =>
                    setIncludeUsageAnalytics((enabled) => !enabled)
                  }
                  disabled={dbLoading}
                />
              </div>
              <div className="flex items-start sm:items-center justify-between gap-4 rounded-lg border border-border bg-bg p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm sm:text-base">
                    Restore Usage & Analytics
                  </p>
                  <p className="text-xs sm:text-sm text-text-muted">
                    When importing a backup that contains analytics, replace the
                    current usage history with the backup data.
                  </p>
                </div>
                <Toggle
                  checked={restoreUsageAnalytics}
                  onChange={() =>
                    setRestoreUsageAnalytics((enabled) => !enabled)
                  }
                  disabled={dbLoading}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="secondary"
                  icon="download"
                  onClick={handleExportDatabase}
                  loading={dbLoading}
                  className="w-full sm:w-auto"
                >
                  Download Backup
                </Button>
                <Button
                  variant="outline"
                  icon="upload"
                  onClick={() => importFileRef.current?.click()}
                  disabled={dbLoading}
                  className="w-full sm:w-auto"
                >
                  Import Backup
                </Button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportDatabase}
                />
              </div>
            </div>
            <ProfileStatus status={dbStatus} />
          </div>
        </Card>

        {/* Security */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <span className="material-symbols-outlined text-[20px]">
                shield
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Security</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">
                  Require login
                </p>
                <p className="text-xs sm:text-sm text-text-muted">
                  When ON, dashboard requires password. When OFF, access without
                  login.
                </p>
              </div>
              <Toggle
                checked={settings.requireLogin === true}
                onChange={() => updateRequireLogin(!settings.requireLogin)}
                disabled={loading}
              />
            </div>
            {settings.requireLogin === true && (
              <form
                onSubmit={handlePasswordChange}
                className="flex flex-col gap-4 pt-4 border-t border-border/50"
              >
                {settings.hasPassword && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs sm:text-sm font-medium">
                      Current Password
                    </label>
                    <Input
                      type="password"
                      placeholder="Enter current password"
                      value={passwords.current}
                      onChange={(e) =>
                        setPasswords({ ...passwords, current: e.target.value })
                      }
                      required
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs sm:text-sm font-medium">
                      New Password
                    </label>
                    <Input
                      type="password"
                      placeholder="Enter new password"
                      value={passwords.new}
                      onChange={(e) =>
                        setPasswords({ ...passwords, new: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs sm:text-sm font-medium">
                      Confirm New Password
                    </label>
                    <Input
                      type="password"
                      placeholder="Confirm new password"
                      value={passwords.confirm}
                      onChange={(e) =>
                        setPasswords({ ...passwords, confirm: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <ProfileStatus status={passStatus} />

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={passLoading}
                    className="w-full sm:w-auto"
                  >
                    {settings.hasPassword ? "Update Password" : "Set Password"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Card>

        {/* OIDC */}
        <Card>
          <button
            type="button"
            onClick={() => setOidcExpanded((v) => !v)}
            className="w-full flex items-center gap-3 text-left"
          >
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 shrink-0">
              <span className="material-symbols-outlined text-[20px]">
                lock_open
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base sm:text-lg font-semibold">
                OIDC Dashboard Login
              </h3>
              <p className="text-xs text-text-muted">
                {settings.authMode === "oidc"
                  ? "OIDC active"
                  : settings.authMode === "both"
                    ? "Password + OIDC active"
                    : "Optional SSO via Authentik/Keycloak/Google"}
              </p>
            </div>
            <span className="material-symbols-outlined text-text-muted shrink-0">
              {oidcExpanded ? "expand_less" : "expand_more"}
            </span>
          </button>
          {oidcExpanded && (
            <div className="flex flex-col gap-4 mt-4">
              <p className="text-xs sm:text-sm text-text-muted">
                Use Authentik or any OIDC provider to sign in to the dashboard.
                You can enable password-only, OIDC-only, or both for the
                dashboard; model API access still uses API keys.
              </p>

              <div className="flex flex-col gap-2">
                <label className="font-medium text-sm sm:text-base">
                  Auth Mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {OIDC_AUTH_MODE_OPTIONS.map((option) => {
                    const active = oidcForm.authMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateOidcForm("authMode", option.value)}
                        className={cn(
                          "text-left rounded-lg border p-3 transition-colors",
                          active
                            ? "border-primary bg-primary/5"
                            : "border-border bg-bg hover:bg-black/5 dark:hover:bg-white/5",
                        )}
                        disabled={loading || oidcLoading}
                      >
                        <p className="font-medium text-sm sm:text-base">
                          {option.title}
                        </p>
                        <p className="text-xs sm:text-sm text-text-muted mt-1">
                          {option.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm sm:text-base">
                    Issuer URL
                  </label>
                  <Input
                    placeholder="https://auth.example.com/application/o/9router/"
                    value={oidcForm.oidcIssuerUrl}
                    onChange={(e) =>
                      updateOidcForm("oidcIssuerUrl", e.target.value)
                    }
                    disabled={loading || oidcLoading}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm sm:text-base">
                    Client ID
                  </label>
                  <Input
                    placeholder="9router-dashboard"
                    value={oidcForm.oidcClientId}
                    onChange={(e) =>
                      updateOidcForm("oidcClientId", e.target.value)
                    }
                    disabled={loading || oidcLoading}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm sm:text-base">
                    Client Secret
                  </label>
                  <Input
                    type="password"
                    placeholder="Leave blank to keep existing secret"
                    value={oidcClientSecret}
                    onChange={(e) => setOidcClientSecret(e.target.value)}
                    disabled={loading || oidcLoading}
                  />
                  <p className="text-xs sm:text-sm text-text-muted">
                    This value is write-only after saving.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm sm:text-base">
                    Scopes
                  </label>
                  <Input
                    placeholder="openid profile email"
                    value={oidcForm.oidcScopes}
                    onChange={(e) =>
                      updateOidcForm("oidcScopes", e.target.value)
                    }
                    disabled={loading || oidcLoading}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm sm:text-base">
                    Login Button Label
                  </label>
                  <Input
                    placeholder="Sign in with OIDC"
                    value={oidcForm.oidcLoginLabel}
                    onChange={(e) =>
                      updateOidcForm("oidcLoginLabel", e.target.value)
                    }
                    disabled={loading || oidcLoading}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border bg-bg p-3 text-xs sm:text-sm text-text-muted">
                <p className="font-medium text-text-main mb-1">Redirect URI</p>
                <code className="block break-all font-mono">
                  {oidcRedirectUri}
                </code>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/50">
                <Button
                  type="button"
                  variant="primary"
                  loading={oidcLoading}
                  onClick={() => saveOidcSettings()}
                  className="w-full sm:w-auto"
                >
                  Save auth mode
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  loading={oidcTestLoading}
                  onClick={testOidcConnection}
                  className="w-full sm:w-auto"
                >
                  Test connection
                </Button>
              </div>

              <ProfileStatus status={oidcTestStatus} />
              <ProfileStatus status={oidcStatus} />

              {settings.authMode === "oidc" && (
                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
                  OIDC login is currently active. Password login is disabled
                  until you switch back.
                </p>
              )}

              {settings.authMode === "both" && (
                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
                  Password and OIDC login are both active.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Routing Preferences */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
              <span className="material-symbols-outlined text-[20px]">
                route
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-semibold">
              Routing Strategy
            </h3>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">Round Robin</p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Cycle through accounts to distribute load
                </p>
              </div>
              <Toggle
                checked={settings.fallbackStrategy === "round-robin"}
                onChange={() =>
                  updateFallbackStrategy(
                    settings.fallbackStrategy === "round-robin"
                      ? "fill-first"
                      : "round-robin",
                  )
                }
                disabled={loading}
              />
            </div>

            {/* Sticky Round Robin Limit */}
            {settings.fallbackStrategy === "round-robin" && (
              <div className="flex items-start sm:items-center justify-between gap-4 pt-2 border-t border-border/50">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm sm:text-base">
                    Sticky Limit
                  </p>
                  <p className="text-xs sm:text-sm text-text-muted">
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
                  className="w-16 sm:w-20 text-center shrink-0"
                />
              </div>
            )}

            {/* Combo Round Robin */}
            <div className="flex items-start sm:items-center justify-between gap-4 pt-4 border-t border-border/50">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">
                  Combo Round Robin
                </p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Cycle through providers in combos instead of always starting
                  with first
                </p>
              </div>
              <Toggle
                checked={settings.comboStrategy === "round-robin"}
                onChange={() =>
                  updateComboStrategy(
                    settings.comboStrategy === "round-robin"
                      ? "fallback"
                      : "round-robin",
                  )
                }
                disabled={loading}
              />
            </div>

            {/* Combo Sticky Round Robin Limit */}
            {settings.comboStrategy === "round-robin" && (
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div>
                  <p className="font-medium">Combo Sticky Limit</p>
                  <p className="text-sm text-text-muted">
                    Calls per combo model before switching
                  </p>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.comboStickyRoundRobinLimit || 1}
                  onChange={(e) => updateComboStickyLimit(e.target.value)}
                  disabled={loading}
                  className="w-20 text-center"
                />
              </div>
            )}

            <p className="text-xs text-text-muted italic pt-2 border-t border-border/50">
              {settings.fallbackStrategy === "round-robin"
                ? `Currently distributing requests across all available accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
                : "Currently using accounts in priority order (Fill First)."}
              {settings.comboStrategy === "round-robin"
                ? ` Combos rotate after ${settings.comboStickyRoundRobinLimit || 1} call${(settings.comboStickyRoundRobinLimit || 1) === 1 ? "" : "s"} per model.`
                : " Combos always start with their first model."}
            </p>
          </div>
        </Card>

        {/* Network */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
              <span className="material-symbols-outlined text-[20px]">
                wifi
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Network</h3>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">
                  Outbound Proxy
                </p>
                <p className="text-xs sm:text-sm text-text-muted">
                  Enable proxy for OAuth + provider outbound requests.
                </p>
              </div>
              <Toggle
                checked={settings.outboundProxyEnabled === true}
                onChange={() =>
                  updateOutboundProxyEnabled(
                    !(settings.outboundProxyEnabled === true),
                  )
                }
                disabled={loading || proxyLoading}
              />
            </div>

            {settings.outboundProxyEnabled === true && (
              <form
                onSubmit={updateOutboundProxy}
                className="flex flex-col gap-4 pt-2 border-t border-border/50"
              >
                <div className="flex flex-col gap-2">
                  <label className="font-medium text-sm sm:text-base">
                    Proxy URL
                  </label>
                  <Input
                    placeholder="http://127.0.0.1:7897"
                    value={proxyForm.outboundProxyUrl}
                    onChange={(e) =>
                      updateProxyForm("outboundProxyUrl", e.target.value)
                    }
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-xs sm:text-sm text-text-muted">
                    Leave empty to inherit existing env proxy (if any).
                  </p>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
                  <label className="font-medium text-sm sm:text-base">
                    No Proxy
                  </label>
                  <Input
                    placeholder="localhost,127.0.0.1"
                    value={proxyForm.outboundNoProxy}
                    onChange={(e) =>
                      updateProxyForm("outboundNoProxy", e.target.value)
                    }
                    disabled={loading || proxyLoading}
                  />
                  <p className="text-xs sm:text-sm text-text-muted">
                    Comma-separated hostnames/domains to bypass the proxy.
                  </p>
                </div>

                <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    loading={proxyTestLoading}
                    disabled={loading || proxyLoading}
                    onClick={testOutboundProxy}
                    className="w-full sm:w-auto"
                  >
                    Test proxy URL
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={proxyLoading}
                    className="w-full sm:w-auto"
                  >
                    Apply
                  </Button>
                </div>
              </form>
            )}

            <ProfileStatus
              status={proxyStatus}
              className="pt-2 border-t border-border/50"
            />
          </div>
        </Card>

        {/* Observability Settings */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 shrink-0">
              <span className="material-symbols-outlined text-[20px]">
                monitoring
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-semibold">
              Observability
            </h3>
          </div>
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base">
                Enable Observability
              </p>
              <p className="text-xs sm:text-sm text-text-muted">
                Record request details for inspection in the logs view
              </p>
            </div>
            <Toggle
              checked={observabilityEnabled}
              onChange={updateObservabilityEnabled}
              disabled={loading}
            />
          </div>
        </Card>

        {/* App Info */}
        <div className="text-center text-xs sm:text-sm text-text-muted py-4">
          <p>
            {APP_CONFIG.name} v{APP_CONFIG.version}
          </p>
          <p className="mt-1">Local Mode - All data stored on your machine</p>
        </div>
      </div>
    </div>
  );
}
