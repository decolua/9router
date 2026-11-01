"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Input from "@/shared/components/Input";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import Select from "@/shared/components/Select";
import { composeGeminiCookie, splitGeminiCookie } from "@/shared/utils/geminiCookieFields";

export default function EditConnectionModal({ isOpen, connection, proxyPools, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    apiKey: "",
  });
  const [geminiParts, setGeminiParts] = useState({ psid: "", psidts: "", extra: "" });
  const [azureData, setAzureData] = useState({
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: "",
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [awsData, setAwsData] = useState({ profile: "", region: "", accessKeyId: "", sessionToken: "" });
  const [clearAwsSessionToken, setClearAwsSessionToken] = useState(false);
  const [region, setRegion] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        apiKey: "",
      });
      // Load Azure-specific data if present
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
      if (AI_PROVIDERS?.[connection.provider]?.credentialForm === "aws") {
        const psd = connection.providerSpecificData || {};
        setAwsData({
          profile: psd.profile || "",
          region: psd.region || "",
          accessKeyId: psd.accessKeyId || "",
          sessionToken: "",
        });
        setClearAwsSessionToken(false);
      }
      // Load region for providers that support it (e.g. xiaomi-tokenplan)
      const providerCfg = AI_PROVIDERS?.[connection.provider];
      if (providerCfg?.regions) {
        const savedRegion = connection.providerSpecificData?.region || providerCfg.defaultRegion || providerCfg.regions[0]?.id || "";
        setRegion(savedRegion);
      }
      setGeminiParts({ psid: "", psidts: "", extra: "" });
      setTestResult(null);
      setTestError(null);
      setValidationResult(null);
      setValidationError(null);
    }
  }, [connection, isOpen]);

  const isOAuth = connection?.authType === "oauth";
  const isGeminiWeb = connection?.provider === "gemini-web";
  const isDeepSeekWeb = connection?.provider === "deepseek-web";
  const isAzure = connection?.provider === "azure";
  const isCloudflareAi = connection?.provider === "cloudflare-ai";
  const usesAwsCredentialForm = AI_PROVIDERS?.[connection?.provider]?.credentialForm === "aws";
  const isCompatible = connection
    ? (isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider))
    : false;
  const providerRegions = connection ? (AI_PROVIDERS?.[connection.provider]?.regions || null) : null;

  // The two cookie parts mirror into formData.apiKey so Check and Save keep their single
  // source of truth. An empty PSID composes to PSIDTS-only, which the server merges into the
  // saved cookie instead of replacing it.
  const updateGeminiPart = (field, rawValue) => {
    const parsed = splitGeminiCookie(rawValue);
    const next = { ...geminiParts };
    if (field === "psid") {
      next.psid = parsed.psid || rawValue.trim();
      if (parsed.psidts) next.psidts = parsed.psidts;
      if (parsed.extra) next.extra = parsed.extra;
    } else {
      next.psidts = parsed.psidts || rawValue.trim();
    }
    setGeminiParts(next);
    setFormData((prev) => ({ ...prev, apiKey: composeGeminiCookie(next) }));
  };


  // Build providerSpecificData for region-aware providers
  const buildRegionSpecificData = () => {
    if (providerRegions && region) return { ...((connection?.providerSpecificData) || {}), region };
    return undefined;
  };

  // The server keeps a saved session token when this password field is blank. Other empty
  // fields still clear their saved values so a profile can be switched to static keys.
  const buildAwsSpecificData = () => ({
    profile: awsData.profile.trim(),
    region: awsData.region.trim(),
    accessKeyId: awsData.accessKeyId.trim(),
    sessionToken: clearAwsSessionToken ? null : awsData.sessionToken.trim(),
  });

  const handleTest = async () => {
    if (!connection?.provider) return;
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data.valid ? "success" : "failed");
      setTestError(data.valid ? data.warning || null : data.error || "Connection test failed");
    } catch (err) {
      setTestResult("failed");
      setTestError(err.message || "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleValidate = async () => {
    if (!connection?.provider || !formData.apiKey) return;
    setValidating(true);
    setValidationResult(null);
    setValidationError(null);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: connection.provider,
          apiKey: formData.apiKey,
          ...(isAzure ? { providerSpecificData: azureData } : {}),
          ...(isCloudflareAi ? { providerSpecificData: cloudflareData } : {}),
          ...(usesAwsCredentialForm ? { providerSpecificData: buildAwsSpecificData() } : {}),
          ...(providerRegions ? { providerSpecificData: buildRegionSpecificData() } : {}),
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
      setValidationError(data.valid ? data.warning || null : data.error || "Validation failed");
    } catch (err) {
      setValidationResult("failed");
      setValidationError(err.message || "Validation request failed");
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
                ...(usesAwsCredentialForm ? { providerSpecificData: buildAwsSpecificData() } : {}),
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
      if (usesAwsCredentialForm) {
        updates.providerSpecificData = buildAwsSpecificData();
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

        {!isOAuth && isGeminiWeb && (
          <div className="flex flex-col gap-3">
            <Input
              label="__Secure-1PSID"
              type="text"
              value={geminiParts.psid}
              onChange={(e) => updateGeminiPart("psid", e.target.value)}
              placeholder="Leave blank to keep the saved session"
              hint="Paste a new PSID to replace the saved cookie; blank keeps it."
            />
            <Input
              label="__Secure-1PSIDTS (optional)"
              type="text"
              value={geminiParts.psidts}
              onChange={(e) => updateGeminiPart("psidts", e.target.value)}
              placeholder="Leave blank to keep the saved timestamp"
              hint="Optional. Blank keeps the saved timestamp instead of wiping it."
            />
            <div className="flex items-center gap-3">
              <Button
                onClick={handleValidate}
                disabled={!geminiParts.psid || validating || saving}
                variant="secondary"
              >
                {validating ? "Checking..." : "Check"}
              </Button>
              {validationResult && (
                <div className="flex flex-col gap-1">
                  <Badge variant={validationResult === "success" ? "success" : "error"}>
                    {validationResult === "success" ? "Valid" : "Invalid"}
                  </Badge>
                  {validationError && (
                    <p className="text-xs text-text-muted break-words">{validationError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {!isOAuth && !isGeminiWeb && (
          <>
            <div className="flex gap-2">
              <Input
                label={isDeepSeekWeb ? "User Token" : connection?.authType === "cookie" ? "Cookie Value" : "API Key"}
                type={connection?.authType === "cookie" ? "text" : "password"}
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder={isDeepSeekWeb ? "Paste new userToken from chat.deepseek.com Local Storage" : connection?.authType === "cookie" ? "Enter new cookie value" : "Enter new API key"}
                hint={isDeepSeekWeb ? "Leave blank to keep current userToken." : connection?.authType === "cookie" ? "Leave blank to keep current cookie." : "Leave blank to keep the current API key."}
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            {validationResult && (
              <div className="flex flex-col gap-1">
                <Badge variant={validationResult === "success" ? "success" : "error"}>
                  {validationResult === "success" ? "Valid" : "Invalid"}
                </Badge>
                {validationError && (
                  <p className="text-xs text-text-muted break-words">{validationError}</p>
                )}
              </div>
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

        {usesAwsCredentialForm && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">AWS Bedrock Credentials</h3>
            <div className="flex flex-col gap-3">
              <Input
                label="AWS Profile (SSO — recommended)"
                value={awsData.profile}
                onChange={(e) => setAwsData({ ...awsData, profile: e.target.value })}
                placeholder="my-sso-profile"
                hint="Clear this to use static keys instead; a profile takes precedence."
              />
              <Input
                label="Region"
                value={awsData.region}
                onChange={(e) => setAwsData({ ...awsData, region: e.target.value })}
                placeholder="us-east-1"
              />
              <Input
                label="Access Key ID (only for static keys)"
                value={awsData.accessKeyId}
                onChange={(e) => setAwsData({ ...awsData, accessKeyId: e.target.value })}
                placeholder="AKIA..."
              />
              <Input
                label="Session Token (only for temporary ASIA… keys)"
                type="password"
                value={awsData.sessionToken}
                onChange={(e) => setAwsData({ ...awsData, sessionToken: e.target.value })}
                placeholder="FwoGZXIvYXdz..."
                hint="Leave blank to keep the saved token. Enter a new token to replace it."
                disabled={clearAwsSessionToken}
              />
              <label className="flex items-center gap-2 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={clearAwsSessionToken}
                  onChange={(e) => {
                    setClearAwsSessionToken(e.target.checked);
                    if (e.target.checked) setAwsData({ ...awsData, sessionToken: "" });
                  }}
                />
                Remove saved session token
              </label>
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
              <div className="flex flex-col gap-1">
                <Badge variant={testResult === "success" ? "success" : "error"}>
                  {testResult === "success" ? "Valid" : "Failed"}
                </Badge>
                {testError && <p className="text-xs text-text-muted break-words">{testError}</p>}
              </div>
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
