"use client";
import CustomJsonFields from "../components/CustomJsonFields";
import { customJsonForm, parseCustomJsonForm } from "@/shared/utils/customJsonForm";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select } from "@/shared/components";

function EditCompatibleNodeForm({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: node.name || "",
    prefix: node.prefix || "",
    apiType: node.apiType || "chat",
    baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
  });
  const [saving, setSaving] = useState(false);
  const [jsonForm, setJsonForm] = useState(() => customJsonForm(node.customJson || undefined));
  const [formError, setFormError] = useState("");
  const isCustom = formData.apiType === "custom-json";
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
    { value: "custom-json", label: "Custom JSON API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
        if (isCustom) payload.customJson = parseCustomJsonForm(jsonForm, formData.baseUrl);
      }
      await onSave(payload);
    } catch (error) { setFormError(error.message); } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setFormError("");
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          apiType: formData.apiType,
          ...(isCustom ? { customJson: parseCustomJsonForm(jsonForm, formData.baseUrl) } : {}),
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
      if (!data.valid) setFormError(data.error || "Validation failed");
    } catch (error) {
      setFormError(error.message);
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  return (
    <Modal isOpen={isOpen} title={isCustom ? "Edit Custom JSON API" : `Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose} size={isCustom ? "xl" : "md"}>
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
          label={isCustom ? "Endpoint URL" : "Base URL"}
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={isCustom ? "Enter the complete HTTP(S) endpoint URL. No path is appended." : `Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
        />
        {isCustom && <CustomJsonFields value={jsonForm} onChange={setJsonForm} />}
        {formError && <p role="alert" className="text-sm text-red-500">{formError}</p>}
        <div className="flex gap-2">
          <Input
            label={isCustom && jsonForm.authType === "none" ? "API Key (not required)" : "API Key (for Check)"}
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={(!checkKey && !(isCustom && jsonForm.authType === "none")) || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? "Checking..." : (isCustom ? "Send Test Request" : "Check")}
            </Button>
          </div>
        </div>
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. my-model-id"
          hint={isCustom ? "Optional model ID used for the test request." : "If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."}
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

export default function EditCompatibleNodeModal(props) {
  return props.isOpen && props.node ? <EditCompatibleNodeForm key={props.node.id} {...props} /> : null;
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};
