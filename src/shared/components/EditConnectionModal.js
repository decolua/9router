"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Input from "@/shared/components/Input";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import Toggle from "@/shared/components/Toggle";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

export default function EditConnectionModal({ isOpen, connection, proxyPools, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    apiKey: "",
    minReserveEnabled: false,
    minReservePercent: 15,
    cooldownEnabled: false,
    cooldownMinutes: 30,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        apiKey: "",
        minReserveEnabled: connection.minReserveEnabled || false,
        minReservePercent: connection.minReservePercent || 15,
        cooldownEnabled: connection.cooldownEnabled || false,
        cooldownMinutes: connection.cooldownMinutes || 30,
      });
      setTestResult(null);
      setValidationResult(null);
    }
  }, [connection]);

  const isOAuth = connection?.authType === "oauth";
  const isCompatible = connection
    ? (isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider))
    : false;
  const supportsQuota = isOAuth && connection && USAGE_SUPPORTED_PROVIDERS.includes(connection.provider);

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
        body: JSON.stringify({ provider: connection.provider, apiKey: formData.apiKey }),
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
        minReserveEnabled: formData.minReserveEnabled,
        minReservePercent: formData.minReservePercent,
        cooldownEnabled: formData.cooldownEnabled,
        cooldownMinutes: formData.cooldownMinutes,
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
              body: JSON.stringify({ provider: connection.provider, apiKey: formData.apiKey }),
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
      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

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

        {supportsQuota && (
          <div className="border border-black/10 dark:border-white/10 rounded-lg p-3 space-y-3">
            <p className="text-sm font-semibold text-text-primary">Quota Management</p>

            {/* Minimum Reserve */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <Toggle
                  size="sm"
                  label="Minimum Reserve"
                  description="Block account when quota drops below threshold"
                  checked={formData.minReserveEnabled}
                  onChange={(val) => setFormData({ ...formData, minReserveEnabled: val })}
                />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Input
                  type="number"
                  value={formData.minReservePercent}
                  onChange={(e) => setFormData({ ...formData, minReservePercent: Math.max(1, Math.min(50, Number(e.target.value) || 15)) })}
                  disabled={!formData.minReserveEnabled}
                  className="!w-16 text-center"
                />
                <span className="text-sm text-text-muted">%</span>
              </div>
            </div>

            {/* Cooldown on Reset */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <Toggle
                  size="sm"
                  label="Cooldown on Reset"
                  description="Rest account after quota resets"
                  checked={formData.cooldownEnabled}
                  onChange={(val) => setFormData({ ...formData, cooldownEnabled: val })}
                />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Input
                  type="number"
                  value={formData.cooldownMinutes}
                  onChange={(e) => setFormData({ ...formData, cooldownMinutes: Math.max(1, Math.min(120, Number(e.target.value) || 30)) })}
                  disabled={!formData.cooldownEnabled}
                  className="!w-16 text-center"
                />
                <span className="text-sm text-text-muted">min</span>
              </div>
            </div>
          </div>
        )}

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

        {!isCompatible && (
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
  }),
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  })),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
