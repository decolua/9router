"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/shared/hooks/useTheme";
import { EMPTY_STATUS, DEFAULT_OIDC_FORM } from "../utils/profileConstants";
import { downloadJsonFile } from "../utils/profileDownloadUtils";
import { getOidcFormFromSettings, getOidcRedirectUri } from "../utils/profileOidcUtils";
import {
  exportDatabaseBackup,
  fetchSettings,
  importDatabaseBackup,
  patchSettings,
  testOidcSettings,
  testProxyUrl,
} from "../services/profileSettingsService";

export function useProfileSettings() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
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
  const [oidcRedirectUri] = useState(getOidcRedirectUri);
  const [oidcExpanded, setOidcExpanded] = useState(false);
  const importFileRef = useRef(null);
  const [proxyForm, setProxyForm] = useState({
    outboundProxyUrl: "",
    outboundNoProxy: "",
    connectionProxyHeadersTimeoutMs: "",
  });
  const [proxyStatus, setProxyStatus] = useState(EMPTY_STATUS);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        if (!data) return;
        setSettings(data);
        setOidcForm(getOidcFormFromSettings(data));
        setOidcClientSecret("");
        if (data?.authMode === "oidc" || data?.authMode === "both") setOidcExpanded(true);
        setProxyForm({
          outboundProxyUrl: data?.outboundProxyUrl || "",
          outboundNoProxy: data?.outboundNoProxy || "",
          connectionProxyHeadersTimeoutMs: data?.connectionProxyHeadersTimeoutMs || "",
        });
      })
      .catch((err) => console.error("Failed to fetch settings:", err))
      .finally(() => setLoading(false));
  }, []);

  const updateSettings = (data) => setSettings((prev) => ({ ...prev, ...data }));

  const updateOutboundProxy = async (e) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus(EMPTY_STATUS);

    try {
      const { ok, data } = await patchSettings({
        outboundProxyUrl: proxyForm.outboundProxyUrl,
        outboundNoProxy: proxyForm.outboundNoProxy,
        connectionProxyHeadersTimeoutMs: proxyForm.connectionProxyHeadersTimeoutMs
          ? parseInt(proxyForm.connectionProxyHeadersTimeoutMs, 10)
          : null,
      });
      if (ok) {
        updateSettings(data);
        setProxyStatus({ type: "success", message: "Proxy settings applied" });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
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
      setProxyStatus({ type: "error", message: "Please enter a Proxy URL to test" });
      return;
    }

    setProxyTestLoading(true);
    setProxyStatus(EMPTY_STATUS);

    try {
      const { ok, data } = await testProxyUrl(proxyUrl);
      if (ok && data?.ok) {
        setProxyStatus({ type: "success", message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms` });
      } else {
        setProxyStatus({ type: "error", message: data?.error || "Proxy test failed" });
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
      const { ok, data } = await patchSettings({ outboundProxyEnabled });
      if (ok) {
        updateSettings(data);
        setProxyStatus({ type: "success", message: outboundProxyEnabled ? "Proxy enabled" : "Proxy disabled" });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
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
      const { ok, data } = await patchSettings({
        currentPassword: passwords.current,
        newPassword: passwords.new,
      });
      if (ok) {
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

  const patchSettingValue = async (payload, localPatch, errorMessage) => {
    try {
      const { ok } = await patchSettings(payload);
      if (ok) updateSettings(localPatch);
    } catch (err) {
      console.error(errorMessage, err);
    }
  };

  const updateFallbackStrategy = (strategy) =>
    patchSettingValue({ fallbackStrategy: strategy }, { fallbackStrategy: strategy }, "Failed to update settings:");
  const updateComboStrategy = (strategy) =>
    patchSettingValue({ comboStrategy: strategy }, { comboStrategy: strategy }, "Failed to update combo strategy:");
  const updateRequireLogin = (requireLogin) =>
    patchSettingValue({ requireLogin }, { requireLogin }, "Failed to update require login:");
  const updateObservabilityEnabled = (enabled) =>
    patchSettingValue({ enableObservability: enabled }, { enableObservability: enabled }, "Failed to update enableObservability:");

  const updateStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;
    await patchSettingValue(
      { stickyRoundRobinLimit: numLimit },
      { stickyRoundRobinLimit: numLimit },
      "Failed to update sticky limit:",
    );
  };

  const updateComboStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;
    await patchSettingValue(
      { comboStickyRoundRobinLimit: numLimit },
      { comboStickyRoundRobinLimit: numLimit },
      "Failed to update combo sticky limit:",
    );
  };

  const updateOidcForm = (field, value) => setOidcForm((prev) => ({ ...prev, [field]: value }));
  const updateProxyForm = (field, value) => setProxyForm((prev) => ({ ...prev, [field]: value }));

  const saveOidcSettings = async (authMode = oidcForm.authMode || DEFAULT_OIDC_FORM.authMode) => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const loginLabel = oidcForm.oidcLoginLabel.trim();
    const secret = oidcClientSecret.trim();

    if (authMode !== "password" && (!issuerUrl || !clientId || !secret) && !settings.oidcConfigured) {
      setOidcStatus({
        type: "error",
        message: "Issuer URL, client ID, and client secret are required to enable OIDC.",
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
        ...(secret ? { oidcClientSecret: secret } : {}),
      };
      const { ok, data } = await patchSettings(payload);
      if (ok) {
        updateSettings(data);
        setOidcForm(getOidcFormFromSettings(data, payload));
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
        setOidcStatus({ type: "error", message: data.error || "Failed to save OIDC settings" });
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
      setOidcTestStatus({ type: "error", message: "Issuer URL and client ID are required to test the connection." });
      return;
    }

    setOidcTestLoading(true);
    setOidcStatus(EMPTY_STATUS);
    setOidcTestStatus(EMPTY_STATUS);

    try {
      const savePayload = {
        authMode: oidcForm.authMode || settings.authMode || "password",
        oidcIssuerUrl: issuerUrl,
        oidcClientId: clientId,
        oidcScopes: scopes || DEFAULT_OIDC_FORM.oidcScopes,
        oidcLoginLabel: oidcForm.oidcLoginLabel.trim() || DEFAULT_OIDC_FORM.oidcLoginLabel,
        ...(secret ? { oidcClientSecret: secret } : {}),
      };
      const { ok: saveOk, data: saved } = await patchSettings(savePayload);
      if (!saveOk) {
        setOidcTestStatus({ type: "error", message: saved.error || "Failed to save OIDC settings before testing" });
        return;
      }

      const { ok, data } = await testOidcSettings({
        issuerUrl: saved.oidcIssuerUrl || issuerUrl,
        clientId: saved.oidcClientId || clientId,
        scopes: saved.oidcScopes || scopes || DEFAULT_OIDC_FORM.oidcScopes,
      });
      if (ok && data?.ok) {
        const statusMessage = data.clientSecretTested
          ? data.clientSecretValid === true
            ? `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret validated too.`
            : `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret was not checked.`
          : `Connection OK. Discovery loaded from ${data.issuerUrl}.`;
        setOidcTestStatus({ type: "success", message: statusMessage });
      } else {
        setOidcTestStatus({ type: "error", message: data.error || "OIDC connection test failed" });
      }
    } catch (err) {
      setOidcTestStatus({ type: "error", message: "An error occurred" });
    } finally {
      setOidcTestLoading(false);
    }
  };

  const reloadSettings = async () => {
    try {
      const data = await fetchSettings();
      if (data) setSettings(data);
    } catch (err) {
      console.error("Failed to reload settings:", err);
    }
  };

  const handleExportDatabase = async () => {
    setDbLoading(true);
    setDbStatus(EMPTY_STATUS);
    try {
      const { ok, data } = await exportDatabaseBackup({ includeUsageAnalytics });
      if (!ok) throw new Error(data.error || "Failed to export database");
      downloadJsonFile(data);
      setDbStatus({ type: "success", message: "Database backup downloaded" });
    } catch (err) {
      setDbStatus({ type: "error", message: err.message || "Failed to export database" });
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
      const shouldRestoreUsageAnalytics = analyticsIncluded && restoreUsageAnalytics;
      const { ok, data } = await importDatabaseBackup({
        ...payload,
        restoreUsageAnalytics: shouldRestoreUsageAnalytics,
      });
      if (!ok) throw new Error(data.error || "Failed to import database");

      await reloadSettings();
      setDbStatus({
        type: "success",
        message:
          analyticsIncluded && !shouldRestoreUsageAnalytics
            ? "Database imported successfully. Usage & Analytics skipped."
            : "Database imported successfully",
      });
    } catch (err) {
      setDbStatus({ type: "error", message: err.message || "Invalid backup file" });
    } finally {
      if (importFileRef.current) importFileRef.current.value = "";
      setDbLoading(false);
    }
  };

  return {
    settings,
    loading,
    localBackup: {
      theme,
      setTheme,
      includeUsageAnalytics,
      setIncludeUsageAnalytics,
      restoreUsageAnalytics,
      setRestoreUsageAnalytics,
      dbLoading,
      dbStatus,
      importFileRef,
      handleExportDatabase,
      handleImportDatabase,
    },
    security: {
      settings,
      loading,
      passwords,
      setPasswords,
      passStatus,
      passLoading,
      updateRequireLogin,
      handlePasswordChange,
    },
    oidc: {
      settings,
      loading,
      oidcExpanded,
      setOidcExpanded,
      oidcForm,
      updateOidcForm,
      oidcClientSecret,
      setOidcClientSecret,
      oidcRedirectUri,
      oidcLoading,
      oidcTestLoading,
      oidcStatus,
      oidcTestStatus,
      saveOidcSettings,
      testOidcConnection,
    },
    routing: {
      settings,
      loading,
      updateFallbackStrategy,
      updateComboStrategy,
      updateStickyLimit,
      updateComboStickyLimit,
    },
    network: {
      settings,
      loading,
      proxyForm,
      updateProxyForm,
      proxyStatus,
      proxyLoading,
      proxyTestLoading,
      updateOutboundProxyEnabled,
      updateOutboundProxy,
      testOutboundProxy,
    },
    observability: {
      observabilityEnabled: settings.enableObservability === true,
      loading,
      updateObservabilityEnabled,
    },
  };
}
