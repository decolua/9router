"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Input, Modal, Select } from "@/shared/components";

const VARIANT_CONFIG = {
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
  multi: {
    title: "Add Multi-protocol Compatible",
    type: "multi-compatible",
    namePlaceholder: "Multi-protocol Provider (Prod)",
    prefixPlaceholder: "multi-prod",
    modelIdPlaceholder: "e.g. shared-model-id",
    errorLabel: "Multi-protocol Compatible",
    hasApiType: false,
    isMulti: true,
  },
};

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];

function AddCompatibleModal({ variant, isOpen, onClose, onCreated }) {
  const config = VARIANT_CONFIG[variant];
  const initialFormData = () => ({
    name: "",
    prefix: "",
    ...(config.hasApiType ? { apiType: "chat" } : {}),
    ...(config.isMulti
      ? {
          openaiUrl: "",
          anthropicUrl: "",
          supportsResponses: false,
        }
      : { baseUrl: config.defaultBaseUrl }),
  });

  const [formData, setFormData] = useState(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  // openai: reset baseUrl when apiType changes; other variants: reset checks when opened
  useEffect(() => {
    if (config.hasApiType) {
      setFormData((prev) => ({ ...prev, baseUrl: config.defaultBaseUrl }));
    } else if (isOpen) {
      setValidationResult(null);
      setCheckKey("");
      setCheckModelId("");
    }
  }, [config.hasApiType, config.defaultBaseUrl, formData.apiType, isOpen]);

  const hasRequiredEndpoints = config.isMulti
    ? formData.openaiUrl.trim() && formData.anthropicUrl.trim()
    : formData.baseUrl.trim();

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !hasRequiredEndpoints) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          ...(config.hasApiType ? { apiType: formData.apiType } : {}),
          ...(config.isMulti
            ? {
                openaiUrl: formData.openaiUrl,
                anthropicUrl: formData.anthropicUrl,
                supportsResponses: formData.supportsResponses,
              }
            : { baseUrl: formData.baseUrl }),
          type: config.type,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData(initialFormData());
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log(`Error creating ${config.errorLabel} node:`, error);
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
          ...(config.isMulti
            ? {
                openaiUrl: formData.openaiUrl,
                anthropicUrl: formData.anthropicUrl,
                supportsResponses: formData.supportsResponses,
              }
            : { baseUrl: formData.baseUrl }),
          apiKey: checkKey,
          type: config.type,
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
      if (config.isMulti && data.valid) {
        setFormData((prev) => ({
          ...prev,
          supportsResponses: Boolean(data.supportsResponses),
        }));
      }
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
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
          {config.isMulti ? (
            <span className="text-sm text-text-muted">
              {validationResult.supportsResponses
                ? "Responses supported"
                : "Responses will use Chat fallback"}
            </span>
          ) : method === "chat" ? (
            <span className="text-sm text-text-muted">(via inference test)</span>
          ) : null}
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
    <Modal isOpen={isOpen} title={config.title} onClose={onClose}>
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
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        {config.isMulti ? (
          <>
            <Input
              label="OpenAI URL"
              value={formData.openaiUrl}
              onChange={(e) => setFormData({
                ...formData,
                openaiUrl: e.target.value,
                supportsResponses: false,
              })}
              placeholder="https://provider.example/v1"
              hint="Required. Base URL, Chat Completions URL, or Responses URL. Check detects Responses support."
            />
            <Input
              label="Anthropic Messages URL"
              value={formData.anthropicUrl}
              onChange={(e) => setFormData({ ...formData, anthropicUrl: e.target.value })}
              placeholder="https://provider.example/v1/messages"
              hint="Required. Base URL or full Anthropic Messages endpoint URL."
            />
          </>
        ) : (
          <Input
            label="Base URL"
            value={formData.baseUrl}
            onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
            placeholder={config.defaultBaseUrl}
            hint={config.baseUrlHint}
          />
        )}
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
        />
        <Input
          label={config.isMulti ? "Model ID" : "Model ID (optional)"}
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder={config.modelIdPlaceholder}
          hint={
            config.isMulti
              ? "Required to check each protocol endpoint."
              : "If the provider lacks /models, enter a model ID to validate with inference."
          }
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || validating || !hasRequiredEndpoints || (config.isMulti && !checkModelId.trim())}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            {validating ? "Checking..." : "Check"}
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
              !hasRequiredEndpoints ||
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

AddCompatibleModal.propTypes = {
  variant: PropTypes.oneOf(["openai", "anthropic", "multi"]).isRequired,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

export default AddCompatibleModal;
