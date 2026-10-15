"use client";
import CustomJsonFields from "./CustomJsonFields";
import { customJsonForm, parseCustomJsonForm } from "@/shared/utils/customJsonForm";

import { useState } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Input, Modal, Select } from "@/shared/components";

const VARIANT_CONFIG = {
  custom: {
    title: "Add Custom JSON API", type: "openai-compatible", apiType: "custom-json",
    defaultBaseUrl: "", namePlaceholder: "Custom API", prefixPlaceholder: "custom",
    baseUrlHint: "Enter the complete endpoint URL. No path is appended.",
    modelIdPlaceholder: "e.g. custom-model", errorLabel: "Custom JSON API", hasApiType: false,
  },
  openai: {
    title: "Add OpenAI Compatible",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    namePlaceholder: "OpenAI Compatible (Prod)",
    prefixPlaceholder: "oc-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your OpenAI-compatible API.",
    modelIdPlaceholder: "e.g. gpt-4, claude-3-opus",
    errorLabel: "OpenAI Compatible",
    hasApiType: true,
  },
  anthropic: {
    title: "Add Anthropic Compatible",
    type: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    namePlaceholder: "Anthropic Compatible (Prod)",
    prefixPlaceholder: "ac-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages.",
    modelIdPlaceholder: "e.g. claude-3-opus",
    errorLabel: "Anthropic Compatible",
    hasApiType: false,
  },
};

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
  { value: "custom-json", label: "Custom JSON API" },
];

function AddCompatibleForm({ variant, isOpen, onClose, onCreated }) {
  const config = VARIANT_CONFIG[variant];
  const initialFormData = () => ({
    name: "",
    prefix: "",
    ...(config.hasApiType || config.apiType ? { apiType: config.apiType || "chat" } : {}),
    baseUrl: config.defaultBaseUrl,
  });

  const [formData, setFormData] = useState(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [jsonForm, setJsonForm] = useState(() => customJsonForm());
  const [formError, setFormError] = useState("");
  const isCustom = formData.apiType === "custom-json";
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          ...(formData.apiType ? { apiType: formData.apiType } : {}),
          ...(isCustom ? { customJson: parseCustomJsonForm(jsonForm, formData.baseUrl) } : {}),
          baseUrl: formData.baseUrl,
          type: config.type,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData(initialFormData());
        setCheckKey("");
        setValidationResult(null);
        setJsonForm(customJsonForm());
      } else { setFormError(data.error || "Failed to create provider"); }
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
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
          type: config.type,
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch (error) {
      setValidationResult({ valid: false, error: error.message });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, method } = validationResult;
    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {method === "chat" && (
            <span className="text-sm text-text-muted">(via inference test)</span>
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
    <Modal isOpen={isOpen} title={config.title} onClose={onClose} size={isCustom ? "xl" : "md"}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={config.namePlaceholder}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={config.prefixPlaceholder}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {config.hasApiType && (
          <Select
            label="API Type"
            options={API_TYPE_OPTIONS}
            value={formData.apiType}
            onChange={(e) => {
              setFormData({ ...formData, apiType: e.target.value, baseUrl: e.target.value === "custom-json" ? "" : config.defaultBaseUrl });
              setValidationResult(null);
            }}
          />
        )}
        <Input
          label={isCustom ? "Endpoint URL" : "Base URL"}
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={config.defaultBaseUrl}
          hint={isCustom ? "Enter the complete HTTP(S) endpoint URL. No path is appended." : config.baseUrlHint}
        />
        {isCustom && <CustomJsonFields value={jsonForm} onChange={setJsonForm} />}
        {formError && <p role="alert" className="text-sm text-red-500">{formError}</p>}
        <Input
          label={isCustom && jsonForm.authType === "none" ? "API Key (not required)" : "API Key (for Check)"}
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
        />
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder={config.modelIdPlaceholder}
          hint={isCustom ? "Optional model ID used for the test request." : "If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={handleValidate}
            disabled={(!checkKey && !(isCustom && jsonForm.authType === "none")) || validating || !formData.baseUrl.trim()}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            {validating ? "Checking..." : (isCustom ? "Send Test Request" : "Check")}
          </Button>
          {renderValidationResult()}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
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

function AddCompatibleModal(props) {
  return props.isOpen ? <AddCompatibleForm {...props} /> : null;
}

AddCompatibleModal.propTypes = {
  variant: PropTypes.oneOf(["openai", "anthropic", "custom"]).isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

export default AddCompatibleModal;
