"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select } from "@/shared/components";

const CLIENT_IDENTITY_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "claude-cli", label: "Claude CLI" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "openclaw", label: "OpenClaw" },
  { value: "custom", label: "Custom Headers" },
];

const BLOCKED_CUSTOM_HEADERS = new Set(["authorization", "x-api-key", "api-key", "cookie"]);

function parseCustomIdentityHeaders(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { headers: {} };

  try {
    let entries;
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "Use a JSON object or Header: value lines." };
      }
      entries = Object.entries(parsed);
    } else {
      entries = [];
      for (const line of trimmed.split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith("#")) continue;
        const sep = value.indexOf(":");
        if (sep <= 0) return { error: "Each custom header line must use Header: value." };
        entries.push([value.slice(0, sep), value.slice(sep + 1)]);
      }
    }

    const headers = {};
    for (const [rawName, rawValue] of entries) {
      const name = String(rawName || "").trim();
      const value = String(rawValue || "").trim();
      if (!name || !value || BLOCKED_CUSTOM_HEADERS.has(name.toLowerCase())) continue;
      headers[name] = value;
    }
    return { headers };
  } catch {
    return { error: "Use valid JSON or Header: value lines." };
  }
}

export default function EditCompatibleNodeModal({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
    clientIdentityProfile: "default",
    clientIdentityHeadersText: "",
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
        clientIdentityProfile: node.clientIdentityProfile || "default",
        clientIdentityHeadersText: node.clientIdentityHeaders
          ? JSON.stringify(node.clientIdentityHeaders, null, 2)
          : "",
      });
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    const customHeaders = formData.clientIdentityProfile === "custom"
      ? parseCustomIdentityHeaders(formData.clientIdentityHeadersText)
      : { headers: {} };
    if (customHeaders.error) {
      setValidationResult("failed");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
        clientIdentityProfile: formData.clientIdentityProfile,
        clientIdentityHeaders: customHeaders.headers,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    const customHeaders = formData.clientIdentityProfile === "custom"
      ? parseCustomIdentityHeaders(formData.clientIdentityHeadersText)
      : { headers: {} };
    if (customHeaders.error) {
      setValidationResult("failed");
      return;
    }
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined,
          clientIdentityProfile: formData.clientIdentityProfile,
          clientIdentityHeaders: customHeaders.headers,
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

  if (!node) return null;

  return (
    <Modal isOpen={isOpen} title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {!isAnthropic && (
          <Select
            label="API Type"
            options={apiTypeOptions}
            value={formData.apiType}
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={`Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
        />
        <Select
          label="Client Identity"
          options={CLIENT_IDENTITY_OPTIONS}
          value={formData.clientIdentityProfile}
          onChange={(e) => setFormData({ ...formData, clientIdentityProfile: e.target.value })}
          hint="Optional. Adds client fingerprint headers for compatible gateways."
        />
        {formData.clientIdentityProfile === "custom" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-main">Custom Headers</label>
            <textarea
              value={formData.clientIdentityHeadersText}
              onChange={(e) => setFormData({ ...formData, clientIdentityHeadersText: e.target.value })}
              placeholder={'{\n  "User-Agent": "custom/1.0"\n}'}
              rows={5}
              className="w-full resize-y rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 text-[16px] text-text-main placeholder-text-muted/70 transition-all duration-150 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-sm"
            />
            <p className="text-xs text-text-muted">JSON object or Header: value lines. Auth headers are ignored.</p>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. my-model-id"
          hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
        />
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
    clientIdentityProfile: PropTypes.string,
    clientIdentityHeaders: PropTypes.object,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
