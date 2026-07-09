"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Input from "@/shared/components/Input";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import { getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import Select from "@/shared/components/Select";

export default function EditConnectionModal({ isOpen, connection, proxyPools, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    apiKey: "",
  });
  const [azureData, setAzureData] = useState({
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: "",
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [region, setRegion] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [allowedModels, setAllowedModels] = useState([]);
  const [showAllowedModelsPicker, setShowAllowedModelsPicker] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [activeProviders, setActiveProviders] = useState([]);

  useEffect(() => {
    if (!connection) return;
    setFormData({
      name: connection.name || "",
      priority: connection.priority || 1,
      apiKey: "",
    });
    if (connection.provider === "azure" && connection.providerSpecificData) {
      setAzureData({
        azureEndpoint: connection.providerSpecificData.azureEndpoint || "",
        apiVersion: connection.providerSpecificData.apiVersion || "2024-10-01-preview",
        deployment: connection.providerSpecificData.deployment || "",
        organization: connection.providerSpecificData.organization || "",
      });
    }
    if (connection.provider === "cloudflare-ai" && connection.providerSpecificData) {
      setCloudflareData({ accountId: connection.providerSpecificData.accountId || "" });
    }
    setAllowedModels(Array.isArray(connection.allowedModels) ? connection.allowedModels : []);
    setTestResult(null);
    setValidationResult(null);
  }, [connection]);

  useEffect(() => {
    if (!isOpen || !connection) return;
    let cancelled = false;
    const fetchAlias = fetch("/api/models/alias")
      .then((r) => (r.ok ? r.json() : { aliases: {} }))
      .then((d) => d.aliases || {})
      .catch(() => ({}));
    Promise.all([
      fetchAlias,
      fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : { nodes: [] })).catch(() => ({ nodes: [] })),
    ]).then(([aliases, nodesRes]) => {
      if (cancelled) return;
      setModelAliases(aliases || {});
      const node = (nodesRes.nodes || []).find((n) => n.id === connection.provider);
      const displayPrefix = node?.prefix || connection.providerSpecificData?.prefix || getProviderAlias(connection.provider);
      setActiveProviders([
        {
          provider: connection.provider,
          name: node?.name || connection.provider,
          providerSpecificData: { ...(connection.providerSpecificData || {}), prefix: displayPrefix },
        },
      ]);
    });
    return () => { cancelled = true; };
  }, [isOpen, connection?.id, connection?.provider, connection?.providerSpecificData?.prefix]);

  const isOAuth = connection?.authType === "oauth";
  const isAzure = connection?.provider === "azure";
  const isCloudflareAi = connection?.provider === "cloudflare-ai";
  const isCompatible = connection
    ? (isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider))
    : false;
  const providerRegions = connection ? (AI_PROVIDERS?.[connection.provider]?.regions || null) : null;

  // Build providerSpecificData for region-aware providers
  const buildRegionSpecificData = () => {
    if (providerRegions && region) return { ...((connection?.providerSpecificData) || {}), region };
    return undefined;
  };

  const handleTest = async () => {
    if (!connection?.provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data.valid ? "success" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  };

  const handleValidate = async () => {
    if (!connection?.provider || !formData.apiKey) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: connection.provider,
          apiKey: formData.apiKey,
          ...(isAzure ? { providerSpecificData: azureData } : {}),
          ...(isCloudflareAi ? { providerSpecificData: cloudflareData } : {}),
          ...(providerRegions ? { providerSpecificData: buildRegionSpecificData() } : {}),
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!connection) return;
    setSaving(true);
    try {
      const updates = {
        name: formData.name,
        priority: formData.priority,
        // Always send an array. The PUT route normalizes an empty list to
        // `null` server-side, and rejects a literal `null` with 400.
        allowedModels,
      };
      if (!isOAuth && formData.apiKey) {
        updates.apiKey = formData.apiKey;
        let isValid = validationResult === "success";
        if (!isValid) {
          try {
            setValidating(true);
            setValidationResult(null);
            const res = await fetch("/api/providers/validate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: connection.provider,
                apiKey: formData.apiKey,
                ...(isAzure ? { providerSpecificData: azureData } : {}),
                ...(isCloudflareAi ? { providerSpecificData: cloudflareData } : {}),
                ...(providerRegions ? { providerSpecificData: buildRegionSpecificData() } : {}),
              }),
            });
            const data = await res.json();
            isValid = !!data.valid;
            setValidationResult(isValid ? "success" : "failed");
          } catch {
            setValidationResult("failed");
          } finally {
            setValidating(false);
          }
        }
        if (isValid) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
        }
      }
      
      // Add Azure-specific data if this is an Azure connection
      if (isAzure) {
        updates.providerSpecificData = {
          azureEndpoint: azureData.azureEndpoint,
          apiVersion: azureData.apiVersion,
          deployment: azureData.deployment,
          organization: azureData.organization,
        };
      }
      if (isCloudflareAi) {
        updates.providerSpecificData = { accountId: cloudflareData.accountId };
      }
      // Persist updated region for region-aware providers
      if (providerRegions && region) {
        updates.providerSpecificData = buildRegionSpecificData();
      }
      
      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

  const displayModelAlias = (modelValue) => modelAliases[modelValue] || modelValue.split("/").pop();

  if (!connection) return null;

  return (
    <Modal isOpen={isOpen} title="Edit Connection" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOAuth ? "Account name" : "Production Key"}
        />
        {isOAuth && connection.email && (
          <div className="bg-sidebar/50 p-3 rounded-lg">
            <p className="text-sm text-text-muted mb-1">Email</p>
            <p className="font-medium">{connection.email}</p>
          </div>
        )}
        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value, 10) || 1 })}
        />

        {!isOAuth && (
          <>
            <div className="flex gap-2">
              <Input
                label="API Key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="Enter new API key"
                hint="Leave blank to keep the current API key."
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            {validationResult && (
              <Badge variant={validationResult === "success" ? "success" : "error"}>
                {validationResult === "success" ? "Valid" : "Invalid"}
              </Badge>
            )}
          </>
        )}

        {isAzure && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Azure OpenAI Configuration</h3>
            <div className="flex flex-col gap-3">
              <Input
                label="Azure Endpoint"
                value={azureData.azureEndpoint}
                onChange={(e) => setAzureData({ ...azureData, azureEndpoint: e.target.value })}
                placeholder="https://your-resource.openai.azure.com"
                hint="Your Azure OpenAI resource endpoint URL"
              />
              <Input
                label="Deployment Name"
                value={azureData.deployment}
                onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })}
                placeholder="gpt-4"
                hint="The deployment name in your Azure resource"
              />
              <Input
                label="API Version"
                value={azureData.apiVersion}
                onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })}
                placeholder="2024-10-01-preview"
                hint="Azure OpenAI API version to use"
              />
              <Input
                label="Organization"
                value={azureData.organization}
                onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })}
                placeholder="Organization ID"
                hint="Required for billing"
              />
            </div>
          </div>
        )}

        {providerRegions && (
          <Select
            label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            options={providerRegions.map((r) => ({ value: r.id, label: r.label }))}
          />
        )}

        {!isCompatible && !isAzure && !isCloudflareAi && (
          <div className="flex items-center gap-3">
            <Button onClick={handleTest} variant="secondary" disabled={testing}>
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            {testResult && (
              <Badge variant={testResult === "success" ? "success" : "error"}>
                {testResult === "success" ? "Valid" : "Failed"}
              </Badge>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Allowed Models</h3>
            {allowedModels.length > 0 && (
              <button
                type="button"
                onClick={() => setAllowedModels([])}
                className="text-xs text-text-muted hover:text-text-main"
              >
                Clear all
              </button>
            )}
          </div>

          {allowedModels.length === 0 ? (
            <div className="bg-sidebar/50 p-3 rounded-lg flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-main">All models allowed</p>
                <p className="text-xs text-text-muted">Restrict this account to a subset of provider models.</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon="tune"
                onClick={() => setShowAllowedModelsPicker(true)}
              >
                Configure Models
              </Button>
            </div>
          ) : (
            <>
              <div
                className="flex flex-col gap-1 max-h-[200px] overflow-y-auto rounded-lg border border-border p-2"
                style={{ background: "var(--color-surface-2, #303030)" }}
              >
                {allowedModels.map((modelValue) => {
                  const alias = displayModelAlias(modelValue);
                  return (
                    <div
                      key={modelValue}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-3/40"
                    >
                      <span
                        className="flex-1 font-mono text-xs text-text-main truncate"
                        title={modelValue}
                      >
                        {alias}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAllowedModels((current) => current.filter((m) => m !== modelValue))
                        }
                        className="text-text-muted hover:text-text-main"
                        aria-label={`Remove ${alias}`}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon="add"
                onClick={() => setShowAllowedModelsPicker(true)}
              >
                Add Model
              </Button>
              <p className="text-xs text-text-muted flex items-center gap-1">
                <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>info</span>
                Empty = all models allowed.
              </p>
            </>
          )}
        </div>

        {showAllowedModelsPicker && (
          <ModelSelectModal
            isOpen
            onClose={() => setShowAllowedModelsPicker(false)}
            onSelect={(model) =>
              setAllowedModels((current) =>
                current.includes(model.value) ? current : [...current, model.value]
              )
            }
            onDeselect={(model) =>
              setAllowedModels((current) => current.filter((m) => m !== model.value))
            }
            addedModelValues={allowedModels}
            closeOnSelect={false}
            hideCombos
            onlyActiveProviders
            activeProviders={activeProviders}
            modelAliases={modelAliases}
            title="Allow Models for this Account"
            kindFilter={null}
          />
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

EditConnectionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    priority: PropTypes.number,
    authType: PropTypes.string,
    provider: PropTypes.string,
    providerSpecificData: PropTypes.object,
    allowedModels: PropTypes.arrayOf(PropTypes.string),
  }),
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  })),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

