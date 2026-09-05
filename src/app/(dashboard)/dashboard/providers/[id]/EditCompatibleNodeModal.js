"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select, Tooltip } from "@/shared/components";
import HeaderFormModal from "./HeaderFormModal";

export default function EditCompatibleNodeModal({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [customHeaders, setCustomHeaders] = useState([]);
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [headerForm, setHeaderForm] = useState({ open: false, mode: "add", index: null });

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
      });
      setCustomHeaders(Array.isArray(node.customHeaders) ? node.customHeaders.map((h) => ({ ...h })) : []);
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  const isInvalidHeaderName = (name) => name.trim() !== "" && !HEADER_NAME_RE.test(name.trim());
  const hasInvalidHeader = customHeaders.some((h) => isInvalidHeaderName(h.name));

  const removeHeader = (index) => setCustomHeaders((rows) => rows.filter((_, i) => i !== index));

  const openAddHeader = () => setHeaderForm({ open: true, mode: "add", index: null });
  const openEditHeader = (index) => setHeaderForm({ open: true, mode: "edit", index });
  const closeHeaderForm = () => setHeaderForm({ open: false, mode: "add", index: null });

  const submitHeaderForm = (row) => {
    setCustomHeaders((rows) => {
      if (headerForm.mode === "edit" && headerForm.index != null) {
        return rows.map((r, i) => (i === headerForm.index ? row : r));
      }
      // add: replace an existing same-name (case-insensitive) row, else append
      const lower = row.name.toLowerCase();
      const existingIdx = rows.findIndex((r) => r.name.trim().toLowerCase() === lower);
      if (existingIdx >= 0) return rows.map((r, i) => (i === existingIdx ? row : r));
      return [...rows, row];
    });
    closeHeaderForm();
  };

  const formatPersist = (ttl) => (ttl === null || ttl === undefined ? "-" : ttl === 0 ? "Permanent" : `${ttl} min`);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || hasInvalidHeader) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      payload.customHeaders = customHeaders
        .filter((h) => h.name.trim() !== "")
        .map((h) => ({ name: h.name.trim(), value: h.value, ttlMinutes: h.ttlMinutes ?? null }));
      await onSave(payload);
    } finally {
      setSaving(false);
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
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined
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
    <Modal isOpen={isOpen} title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose} disableEscape={headerForm.open} closeOnOverlay={!headerForm.open}>
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
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Request Headers</label>
            <Button type="button" variant="secondary" onClick={openAddHeader}>
              + Add
            </Button>
          </div>
          <div className="border border-border-subtle rounded-[10px] overflow-hidden">
            {/* table-fixed keeps columns within the container so the Actions
                column (Edit/Delete) can never be pushed out of view by a long
                value or a wide Persist label like "Permanent". */}
            <table className="w-full text-sm table-fixed">
              <thead className="bg-surface-2 text-text-muted">
                <tr>
                  <th className="text-left font-medium px-3 py-2 w-[28%]">Name</th>
                  <th className="text-left font-medium px-3 py-2">Value</th>
                  <th className="text-left font-medium px-3 py-2 w-[92px]">Persist</th>
                  <th className="text-right font-medium px-3 py-2 w-[96px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customHeaders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-text-muted">No custom headers</td>
                  </tr>
                )}
                {customHeaders.map((h, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono truncate" title={h.name}>{h.name}</td>
                    <td className="px-3 py-2 truncate" title={h.value}>{h.value}</td>
                    <td className="px-3 py-2 truncate">{formatPersist(h.ttlMinutes)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="Edit" position="top">
                          <Button type="button" variant="ghost" size="sm" icon="edit" className="!px-2" onClick={() => openEditHeader(i)} />
                        </Tooltip>
                        <Tooltip text="Delete" position="top">
                          <Button type="button" variant="ghost" size="sm" icon="delete" className="!px-2" onClick={() => removeHeader(i)} />
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-500">
            Overrides preset headers of the same name. Persist reuses the resolved
            value per connection (0 minutes = permanent, until restart).
          </p>
        </div>
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
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving || hasInvalidHeader}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
        <HeaderFormModal
          isOpen={headerForm.open}
          mode={headerForm.mode}
          initial={headerForm.index != null ? customHeaders[headerForm.index] : null}
          existingNames={customHeaders
            .filter((_, i) => i !== headerForm.index)
            .map((h) => h.name.trim().toLowerCase())}
          onSubmit={submitHeaderForm}
          onClose={closeHeaderForm}
        />
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
    customHeaders: PropTypes.arrayOf(
      PropTypes.shape({ name: PropTypes.string, value: PropTypes.string, ttlMinutes: PropTypes.number })
    ),
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
