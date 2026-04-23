"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import {
  Card,
  CardSkeleton,
  Badge,
  Button,
  Input,
  Modal,
  Select,
  Toggle,
} from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import Link from "next/link";
import { getRelativeTime } from "@/shared/utils";
import { useNotificationStore } from "@/store/notificationStore";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import { getConnectionErrorTag } from "./errorTag";
import { getDashboardConnectionStatus, getStatusDisplayItems } from "./statusDisplay";

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCredentialImportModal, setShowCredentialImportModal] =
    useState(false);
  const [credentialImportText, setCredentialImportText] = useState("");
  const [credentialImportFileName, setCredentialImportFileName] = useState("");
  const [importingCredentials, setImportingCredentials] = useState(false);
  const [credentialImportStatus, setCredentialImportStatus] = useState({
    type: "",
    message: "",
    detail: "",
  });
  const [exportingCredentials, setExportingCredentials] = useState(false);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] =
    useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [providerSummaries, setProviderSummaries] = useState({});
  const credentialFileInputRef = useRef(null);
  const notify = useNotificationStore();

  const refreshConnections = async () => {
    const res = await fetch("/api/providers");
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Failed to refresh providers");
    }
    setConnections(data.connections || []);
    setProviderSummaries(data.providerSummaries || {});
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [connectionsRes, nodesRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
        ]);
        const connectionsData = await connectionsRes.json();
        const nodesData = await nodesRes.json();
        if (connectionsRes.ok) {
          setConnections(connectionsData.connections || []);
          setProviderSummaries(connectionsData.providerSummaries || {});
        }
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
      } catch (error) {
        console.log("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleExportCredentials = async () => {
    setExportingCredentials(true);
    try {
      const res = await fetch("/api/credentials/export");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to export credentials");
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `9router-credentials-${timestamp}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      notify.success("Credentials backup exported");
    } catch (error) {
      notify.error(error?.message || "Failed to export credentials");
    } finally {
      setExportingCredentials(false);
    }
  };

  const handlePickImportFile = () => {
    credentialFileInputRef.current?.click();
  };

  const handleCredentialFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setCredentialImportText(text);
      setCredentialImportFileName(file.name);
      setCredentialImportStatus({
        type: "info",
        message: "Backup file loaded",
        detail: file.name,
      });
      notify.success(`Loaded backup file: ${file.name}`);
    } catch {
      setCredentialImportStatus({
        type: "error",
        message: "Failed to read backup file",
        detail: "Choose a valid JSON backup file",
      });
      notify.error("Failed to read backup file");
    } finally {
      // Allow selecting the same file again.
      event.target.value = "";
    }
  };

  const handleImportCredentials = async () => {
    if (!credentialImportText.trim()) {
      setCredentialImportStatus({
        type: "warning",
        message: "No backup JSON found",
        detail: "Paste backup JSON or choose a file before restoring",
      });
      notify.warning("Please paste a backup JSON or choose a backup file");
      return;
    }

    setImportingCredentials(true);
    setCredentialImportStatus({
      type: "info",
      message: "Validating backup JSON",
      detail: credentialImportFileName || "Parsing pasted backup text",
    });
    try {
      const payload = JSON.parse(credentialImportText);
      setCredentialImportStatus({
        type: "info",
        message: "Uploading backup to restore service",
        detail: "Sending credentials for import",
      });
      const res = await fetch("/api/credentials/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to import credentials");
      }

      setCredentialImportStatus({
        type: "info",
        message: "Import complete",
        detail: `Refreshing providers after ${data.imported} imported, ${data.updated} updated${data.skipped ? `, ${data.skipped} skipped` : ""}`,
      });
      try {
        await refreshConnections();
      } catch {
        setCredentialImportStatus({
          type: "warning",
          message: "Import completed, but provider refresh failed",
          detail: "The restored credentials are saved; close the modal and refresh the page later if needed.",
        });
      }
      setCredentialImportText("");
      setCredentialImportFileName("");
      if (credentialFileInputRef.current) {
        credentialFileInputRef.current.value = "";
      }
      setCredentialImportStatus({
        type: "success",
        message: "Credentials restored successfully",
        detail: `${data.imported} imported, ${data.updated} updated, ${data.created} created${data.skipped ? `, ${data.skipped} skipped` : ""}`,
      });

      setShowCredentialImportModal(false);
      setCredentialImportText("");
      setCredentialImportFileName("");
      if (credentialFileInputRef.current) {
        credentialFileInputRef.current.value = "";
      }

      notify.success(
        `Credentials restored (${data.imported} imported, ${data.updated} updated, ${data.created} created${data.skipped ? `, ${data.skipped} skipped` : ""})`,
      );
    } catch (error) {
      setCredentialImportStatus({
        type: "error",
        message: "Restore failed",
        detail: error?.message || "Failed to import credentials",
      });
      notify.error(error?.message || "Failed to import credentials");
    } finally {
      setImportingCredentials(false);
    }
  };

  const getProviderStats = (providerId, authType) => {
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && c.authType === authType,
    );

    const summary = providerSummaries?.[providerId]?.[authType];
    if (summary) {
      return {
        connected: summary.connected,
        error: summary.error,
        unknown: summary.unknown,
        total: summary.total,
        errorCode: providerConnections
          .filter((c) => {
            const status = getDashboardConnectionStatus(c);
            return status === "blocked" || status === "exhausted";
          })
          .sort((a, b) => new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0))[0]
          ? getConnectionErrorTag(
              providerConnections
                .filter((c) => {
                  const status = getDashboardConnectionStatus(c);
                  return status === "blocked" || status === "exhausted";
                })
                .sort((a, b) => new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0))[0],
            )
          : null,
        errorTime: providerConnections
          .filter((c) => {
            const status = getDashboardConnectionStatus(c);
            return status === "blocked" || status === "exhausted";
          })
          .sort((a, b) => new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0))[0]?.lastCheckedAt
          ? getRelativeTime(
              providerConnections
                .filter((c) => {
                  const status = getDashboardConnectionStatus(c);
                  return status === "blocked" || status === "exhausted";
                })
                .sort((a, b) => new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0))[0].lastCheckedAt,
            )
          : null,
        allDisabled: summary.total > 0 && providerConnections.every((c) => c.isActive === false),
      };
    }

    const getEffectiveStatus = (conn) => getDashboardConnectionStatus(conn);

    const connected = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "eligible";
    }).length;

    const errorConns = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "blocked" || status === "exhausted";
    });

    const error = errorConns.length;
    const total = providerConnections.length;
    const unknown = Math.max(total - connected - error, 0);
    const allDisabled =
      total > 0 && providerConnections.every((c) => c.isActive === false);

    const latestError = errorConns.sort(
      (a, b) => new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0),
    )[0];
    const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
    const errorTime = latestError?.lastCheckedAt
      ? getRelativeTime(latestError.lastCheckedAt)
      : null;

    return { connected, error, unknown, total, errorCode, errorTime, allDisabled };
  };

  // Toggle all connections for a provider on/off
  const handleToggleProvider = async (providerId, authType, newActive) => {
    const providerConns = connections.filter(
      (c) => c.provider === providerId && c.authType === authType,
    );
    setConnections((prev) =>
      prev.map((c) =>
        c.provider === providerId && c.authType === authType
          ? { ...c, isActive: newActive }
          : c,
      ),
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );
  };

  const handleBatchTest = async (mode, providerId = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (failed === 0) notify.success(`All ${total} tests passed`);
        else notify.warning(`${passed}/${total} passed, ${failed} failed`);
      }
    } catch (error) {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }));

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
    }));

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="border border-border shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-black/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
              <span className="material-symbols-outlined text-[14px]">
                backup
              </span>
              Credentials
            </div>
            <h2 className="mt-3 text-lg font-semibold text-text-main">
              Backup and restore credentials
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
              Export and restore access tokens, refresh tokens, API keys, and
              provider-specific auth data. This keeps OAuth sessions like Codex
              usable after moving devices.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-bg/80 p-2 shadow-inner">
            <Button
              variant="outline"
              size="sm"
              icon="upload"
              onClick={handleExportCredentials}
              loading={exportingCredentials}
              className="min-w-[96px]"
            >
              Export
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="download"
              onClick={() => setShowCredentialImportModal(true)}
              className="min-w-[96px]"
            >
              Import
            </Button>
          </div>
        </div>
      </Card>

      {/* OAuth Providers */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            OAuth Providers
          </h2>
          <div className="flex items-center gap-2">
            <ModelAvailabilityBadge />
            <button
              onClick={() => handleBatchTest("oauth")}
              disabled={!!testingMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                testingMode === "oauth"
                  ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                  : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40"
              }`}
              title="Test all OAuth connections"
              aria-label="Test all OAuth connections"
            >
              <span
                className={`material-symbols-outlined text-[14px]${testingMode === "oauth" ? " animate-spin" : ""}`}
              >
                play_arrow
              </span>
              {testingMode === "oauth" ? "Testing..." : "Test All"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(OAUTH_PROVIDERS).map(([key, info]) => (
            <ProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "oauth")}
              authType="oauth"
              onToggle={(active) => handleToggleProvider(key, "oauth", active)}
            />
          ))}
        </div>
      </div>

      {/* Free & Free Tier Providers */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            Free &amp; Free Tier Providers
          </h2>
          <button
            onClick={() => handleBatchTest("free")}
            disabled={!!testingMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              testingMode === "free"
                ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40"
            }`}
            title="Test all Free connections"
            aria-label="Test all Free provider connections"
          >
            <span
              className={`material-symbols-outlined text-[14px]${testingMode === "free" ? " animate-spin" : ""}`}
            >
              play_arrow
            </span>
            {testingMode === "free" ? "Testing..." : "Test All"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(FREE_PROVIDERS).map(([key, info]) => (
            <ProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "oauth")}
              authType="free"
              onToggle={(active) => handleToggleProvider(key, "oauth", active)}
            />
          ))}
          {Object.entries(FREE_TIER_PROVIDERS).map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              authType="apikey"
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </div>
      </div>

      {/* API Key Providers — fixed list */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            API Key Providers{" "}
          </h2>
          <button
            onClick={() => handleBatchTest("apikey")}
            disabled={!!testingMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              testingMode === "apikey"
                ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40"
            }`}
            title="Test all API Key connections"
            aria-label="Test all API Key connections"
          >
            <span
              className={`material-symbols-outlined text-[14px]${testingMode === "apikey" ? " animate-spin" : ""}`}
            >
              play_arrow
            </span>
            {testingMode === "apikey" ? "Testing..." : "Test All"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(APIKEY_PROVIDERS)
            .filter(([, info]) => (info.serviceKinds ?? ["llm"]).includes("llm"))
            .map(([key, info]) => (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "apikey")}
                authType="apikey"
                onToggle={(active) => handleToggleProvider(key, "apikey", active)}
              />
            ))}
        </div>
      </div>

      {/* Web Cookie Providers — use browser subscription cookie instead of API key */}
      {/* <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            Web Cookie Providers{" "}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(WEB_COOKIE_PROVIDERS).map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              authType="apikey"
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </div>
      </div> */}

      {/* API Key Compatible Providers — dynamic (OpenAI/Anthropic compatible) */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            API Key Compatible Providers{" "}
          </h2>
          <div className="flex gap-2">
            {/* {(compatibleProviders.length > 0 || anthropicCompatibleProviders.length > 0) && (
              <button
                onClick={() => handleBatchTest("compatible")}
                disabled={!!testingMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${testingMode === "compatible"
                  ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                  : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40"
                  }`}
                title="Test all Compatible connections"
              >
                <span className={`material-symbols-outlined text-[14px]${testingMode === "compatible" ? " animate-spin" : ""}`}>
                  play_arrow
                </span>
                {testingMode === "compatible" ? "Testing..." : "Test All"}
              </button>
            )} */}
            <Button
              size="sm"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
            >
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="!bg-white !text-black hover:!bg-gray-100"
            >
              Add OpenAI Compatible
            </Button>
          </div>
        </div>
        {compatibleProviders.length === 0 &&
        anthropicCompatibleProviders.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-border rounded-xl">
            <span className="material-symbols-outlined text-[32px] text-text-muted mb-2">
              extension
            </span>
            <p className="text-text-muted text-sm">
              No compatible providers added yet
            </p>
            <p className="text-text-muted text-xs mt-1">
              Use the buttons above to add OpenAI or Anthropic compatible
              endpoints
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...compatibleProviders, ...anthropicCompatibleProviders].map(
              (info) => (
                <ApiKeyProviderCard
                  key={info.id}
                  providerId={info.id}
                  provider={info}
                  stats={getProviderStats(info.id, "apikey")}
                  authType="compatible"
                  onToggle={(active) =>
                    handleToggleProvider(info.id, "apikey", active)
                  }
                />
              ),
            )}
          </div>
        )}
      </div>

      <AddOpenAICompatibleModal
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddAnthropicCompatibleModal
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />

      {/* Test Results Modal */}
      {testResults && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
          onClick={() => setTestResults(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-surface border border-border rounded-xl w-full max-w-[600px] max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-border bg-surface/95 backdrop-blur-sm rounded-t-xl">
              <h3 className="font-semibold">Test Results</h3>
              <button
                onClick={() => setTestResults(null)}
                className="p-1 rounded-lg hover:bg-bg text-text-muted hover:text-text-main transition-colors"
                aria-label="Close test results"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="p-5">
              <ProviderTestResultsView results={testResults} />
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={showCredentialImportModal}
        onClose={() => {
          if (importingCredentials) return;
          setShowCredentialImportModal(false);
          setCredentialImportStatus({ type: "", message: "", detail: "" });
        }}
        title="Import Credentials Backup"
        size="lg"
        closeOnOverlay={false}
        closeOnEscape={false}
        showCloseButton={false}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setShowCredentialImportModal(false);
                setCredentialImportText("");
                setCredentialImportFileName("");
                setCredentialImportStatus({ type: "", message: "", detail: "" });
                if (credentialFileInputRef.current) {
                  credentialFileInputRef.current.value = "";
                }
              }}
              disabled={importingCredentials}
            >
              Close
            </Button>
            <Button
              variant="primary"
              icon="download"
              onClick={handleImportCredentials}
              loading={importingCredentials}
              disabled={importingCredentials}
            >
              Restore Credentials
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="text-sm text-text-muted">
            Paste exported backup JSON or load a backup file. Existing provider
            connections will be matched and updated so refresh tokens (including
            Codex OAuth tokens) remain usable. Import accepts universal JSON
            shapes (entries/credentials/items/connections) with camelCase or
            snake_case fields.
          </div>

          <div
            className={`rounded-xl border px-4 py-3 ${credentialImportStatus.type === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
              : credentialImportStatus.type === "success"
                ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
                : credentialImportStatus.type === "warning"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : credentialImportStatus.type === "info"
                    ? "border-primary/30 bg-primary/10 text-text-main"
                    : "border-border bg-bg/60 text-text-muted"
              }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <span className="material-symbols-outlined text-[18px]">
                  {importingCredentials
                    ? "progress_activity"
                    : credentialImportStatus.type === "error"
                      ? "error"
                      : credentialImportStatus.type === "success"
                        ? "check_circle"
                        : credentialImportStatus.type === "warning"
                          ? "warning"
                          : "info"}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {credentialImportStatus.message ||
                    (importingCredentials
                      ? "Restoring credentials"
                      : "Ready to restore")}
                </div>
                <div className="mt-1 text-sm opacity-90 break-words">
                  {credentialImportStatus.detail ||
                    (importingCredentials
                      ? "The modal stays open until the restore finishes."
                      : "Load a backup file or paste JSON to begin.")}
                </div>
                {importingCredentials && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              icon="upload_file"
              onClick={handlePickImportFile}
            >
              Choose Backup File
            </Button>
            {credentialImportFileName && (
              <span className="text-xs text-text-muted">
                Loaded: {credentialImportFileName}
              </span>
            )}
          </div>

          <input
            ref={credentialFileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleCredentialFileChange}
          />

          <textarea
            value={credentialImportText}
            onChange={(e) => setCredentialImportText(e.target.value)}
            className="w-full min-h-[240px] rounded-lg border border-border bg-bg p-3 text-sm font-mono text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Paste credentials backup JSON here"
          />
        </div>
      </Modal>
    </div>
  );
}

function ProviderCard({ providerId, provider, stats, authType, onToggle }) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isNoAuth = !!provider.noAuth;

  const dotColors = {
    free: "bg-green-500",
    oauth: "bg-blue-500",
    apikey: "bg-amber-500",
    compatible: "bg-orange-500",
  };
  const dotLabels = {
    free: "Free",
    oauth: "OAuth",
    apikey: "API Key",
    compatible: "Compatible",
  };

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="size-8 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${provider.color?.length > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={`/providers/${provider.id}.png`}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div>
              <h3 className="font-semibold">{provider.name}</h3>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        pause_circle
                      </span>
                      Disabled
                    </span>
                  </Badge>
                ) : isNoAuth ? (
                  <Badge variant="success" size="sm" dot>Ready</Badge>
                ) : (
                  <>
                     {getStatusDisplayItems(connected, error, stats.total, errorCode).map((item) => (
                      <Badge key={item.key} variant={item.variant} size="sm" dot={item.dot}>
                        {item.label}
                      </Badge>
                    ))}
                    {errorTime && (
                      <span className="text-text-muted">{errorTime}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Toggle
                  size="sm"
                  checked={!allDisabled}
                  onChange={() => {}}
                  title={allDisabled ? "Enable provider" : "Disable provider"}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

ProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  authType,
  onToggle,
}) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX,
  );

  const dotColors = {
    free: "bg-green-500",
    oauth: "bg-blue-500",
    apikey: "bg-amber-500",
    compatible: "bg-orange-500",
  };
  const dotLabels = {
    free: "Free",
    oauth: "OAuth",
    apikey: "API Key",
    compatible: "Compatible",
  };

  const getIconPath = () => {
    if (isCompatible)
      return provider.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return `/providers/${provider.id}.png`;
  };

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="size-8 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${provider.color?.length > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={getIconPath()}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div>
              <h3 className="font-semibold">{provider.name}</h3>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" size="sm">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        pause_circle
                      </span>
                      Disabled
                    </span>
                  </Badge>
                ) : (
                  <>
                     {getStatusDisplayItems(connected, error, stats.total, errorCode).map((item) => (
                      <Badge key={item.key} variant={item.variant} size="sm" dot={item.dot}>
                        {item.label}
                      </Badge>
                    ))}
                    {isCompatible && (
                      <Badge variant="default" size="sm">
                        {provider.apiType === "responses"
                          ? "Responses"
                          : "Chat"}
                      </Badge>
                    )}
                    {isAnthropicCompatible && (
                      <Badge variant="default" size="sm">
                        Messages
                      </Badge>
                    )}
                    {errorTime && (
                      <span className="text-text-muted">{errorTime}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Toggle
                  size="sm"
                  checked={!allDisabled}
                  onChange={() => {}}
                  title={allDisabled ? "Enable provider" : "Disable provider"}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    connected: PropTypes.number,
    error: PropTypes.number,
    errorCode: PropTypes.string,
    errorTime: PropTypes.string,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function AddOpenAICompatibleModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  useEffect(() => {
    const defaultBaseUrl = "https://api.openai.com/v1";
    setFormData((prev) => ({ ...prev, baseUrl: defaultBaseUrl }));
  }, [formData.apiType]);

  const handleSubmit = async () => {
    if (
      !formData.name.trim() ||
      !formData.prefix.trim() ||
      !formData.baseUrl.trim()
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          apiType: formData.apiType,
          baseUrl: formData.baseUrl,
          type: "openai-compatible",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData({
          name: "",
          prefix: "",
          apiType: "chat",
          baseUrl: "https://api.openai.com/v1",
        });
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log("Error creating OpenAI Compatible node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "openai-compatible",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  // Helper to render validation result
  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, method } = validationResult;

    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {method === "chat" && (
            <span className="text-sm text-text-muted">
              (via inference test)
            </span>
          )}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="error">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} title="Add OpenAI Compatible" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="OpenAI Compatible (Prod)"
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="oc-prod"
          hint="Required. Used as the provider prefix for model IDs."
        />
        <Select
          label="API Type"
          options={apiTypeOptions}
          value={formData.apiType}
          onChange={(e) =>
            setFormData({ ...formData, apiType: e.target.value })
          }
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) =>
            setFormData({ ...formData, baseUrl: e.target.value })
          }
          placeholder="https://api.openai.com/v1"
          hint="Use the base URL (ending in /v1) for your OpenAI-compatible API."
        />
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
        />
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. gpt-4, claude-3-opus"
          hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || validating || !formData.baseUrl.trim()}
            variant="secondary"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          {renderValidationResult()}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !formData.baseUrl.trim() ||
              submitting
            }
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddOpenAICompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

function AddAnthropicCompatibleModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: "https://api.anthropic.com/v1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null); // { valid, error, method }

  useEffect(() => {
    if (isOpen) {
      setValidationResult(null);
      setCheckKey("");
      setCheckModelId("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (
      !formData.name.trim() ||
      !formData.prefix.trim() ||
      !formData.baseUrl.trim()
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          baseUrl: formData.baseUrl,
          type: "anthropic-compatible",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData({
          name: "",
          prefix: "",
          baseUrl: "https://api.anthropic.com/v1",
        });
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log("Error creating Anthropic Compatible node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "anthropic-compatible",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  // Helper to render validation result
  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, method } = validationResult;

    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {method === "chat" && (
            <span className="text-sm text-text-muted">
              (via inference test)
            </span>
          )}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="error">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} title="Add Anthropic Compatible" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Anthropic Compatible (Prod)"
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="ac-prod"
          hint="Required. Used as the provider prefix for model IDs."
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) =>
            setFormData({ ...formData, baseUrl: e.target.value })
          }
          placeholder="https://api.anthropic.com/v1"
          hint="Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages."
        />
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
        />
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. claude-3-opus"
          hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || validating || !formData.baseUrl.trim()}
            variant="secondary"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          {renderValidationResult()}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !formData.baseUrl.trim() ||
              submitting
            }
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddAnthropicCompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

function ProviderTestResultsView({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="text-center py-6">
        <span className="material-symbols-outlined text-red-500 text-[32px] mb-2 block">
          error
        </span>
        <p className="text-sm text-red-400">{results.error}</p>
      </div>
    );
  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel =
    {
      oauth: "OAuth",
      free: "Free",
      apikey: "API Key",
      provider: "Provider",
      all: "All",
    }[mode] || mode;

  return (
    <div className="flex flex-col gap-3">
      {summary && (
        <div className="flex items-center gap-3 text-xs mb-1">
          <span className="text-text-muted">{modeLabel} Test</span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
            {summary.passed} passed
          </span>
          {summary.failed > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">
              {summary.failed} failed
            </span>
          )}
          <span className="text-text-muted ml-auto">
            {summary.total} tested
          </span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.connectionId || i}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03]"
        >
          <span
            className={`material-symbols-outlined text-[16px] ${r.valid ? "text-emerald-500" : "text-red-500"}`}
          >
            {r.valid ? "check_circle" : "error"}
          </span>
          <div className="flex-1 min-w-0">
            <span className="font-medium">{r.connectionName}</span>
            <span className="text-text-muted ml-1.5">({r.provider})</span>
          </div>
          {r.latencyMs !== undefined && (
            <span className="text-text-muted font-mono tabular-nums">
              {r.latencyMs}ms
            </span>
          )}
          <span
            className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
              r.valid
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="text-center py-4 text-text-muted text-sm">
          No active connections found for this group.
        </div>
      )}
    </div>
  );
}

ProviderTestResultsView.propTypes = {
  results: PropTypes.shape({
    mode: PropTypes.string,
    results: PropTypes.array,
    summary: PropTypes.shape({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
    }),
    error: PropTypes.string,
  }).isRequired,
};
