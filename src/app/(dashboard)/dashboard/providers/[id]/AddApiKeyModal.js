"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";

const BULK_PLACEHOLDER = `name1|sk-key1\nname2|sk-key2\nsk-key-only-auto-named`;



export default function AddApiKeyModal({ isOpen, provider, providerName, isCompatible, isAnthropic, authType, authHint, website, proxyPools, error, onSave, onBulkDone, onClose }) {
  const NONE_PROXY_POOL_VALUE = "__none__";
  const isOllamaLocal = provider === "ollama-local";
  const isCookie = authType === "cookie";
  const isDeepseekFree = provider === "deepseek-free";

  const isKimiFree = provider === "kimi-free";
  const isXaiApiKey = provider === "xai" && !isCookie;
  const credentialLabel = isCookie
    ? "Cookie Value"
    : isDeepseekFree
    ? "Password"
    : isKimiFree
    ? "Kimi Web Token"
    : "API Key";

  const credentialPlaceholder = isCookie
    ? ((provider === "grok-web" || provider === "grok-free") ? "sso=xxxxx... or just the raw value" : "eyJhbGciOi...")
    : isDeepseekFree
    ? "Your Password"
    : isKimiFree
    ? "Paste your Kimi JWT access token or refresh token"
    : (isXaiApiKey ? "xai-..." : "");

  const isAzure = provider === "azure";
  const isCloudflareAi = provider === "cloudflare-ai";
  const providerRegions = AI_PROVIDERS?.[provider]?.regions || null;
  const defaultRegion = AI_PROVIDERS?.[provider]?.defaultRegion || providerRegions?.[0]?.id || "";

  const [deepseekFreeData, setDeepseekFreeData] = useState({ username: "" });


  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    defaultModel: "",
    priority: 1,
    proxyPoolId: NONE_PROXY_POOL_VALUE,
    ollamaHostUrl: "",
  });
  const [azureData, setAzureData] = useState({
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: "",
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [region, setRegion] = useState(defaultRegion);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("single"); // "single" | "bulk"
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState(null); // { success, failed }
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthStatus, setOauthStatus] = useState("");
  const [kimiOauthStep, setKimiOauthStep] = useState("idle"); // "idle" | "input"
  const [kimiCallbackUrl, setKimiCallbackUrl] = useState("");

  const handleKimiGoogleLogin = () => {
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=626581754197-v82pavblj7tgk6ap9ouqbi9lv821l6qo.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fwww.kimi.com%2Fgoogle-callback&response_type=id_token&scope=email%20profile&nonce=mtwbsa5z4qc";
    window.open(authUrl, "_blank", "width=500,height=600,noopener,noreferrer");
    setKimiOauthStep("input");
    setOauthStatus("Google Sign-In page opened. Log in, copy the final callback URL, and paste it below.");
  };

  const handleKimiCallbackUrlChange = async (urlStr) => {
    setKimiCallbackUrl(urlStr);
    if (!urlStr.trim()) return;

    try {
      let token = "";
      const trimmedUrl = urlStr.trim();
      
      // If the user pasted the raw token directly instead of a callback URL, detect it
      if (trimmedUrl.startsWith("eyJ") && trimmedUrl.split(".").length === 3) {
        token = trimmedUrl;
      } else {
        try {
          const parsedUrl = new URL(trimmedUrl);
          // Google returns token in the hash fragment for response_type=id_token
          const hashStr = parsedUrl.hash ? parsedUrl.hash.substring(1) : "";
          const searchStr = parsedUrl.search ? parsedUrl.search.substring(1) : "";
          
          const hashParams = new URLSearchParams(hashStr);
          const searchParams = new URLSearchParams(searchStr);
          
          token = hashParams.get("id_token") || searchParams.get("id_token") || 
                  hashParams.get("code") || searchParams.get("code") || "";
        } catch {
          // Fallback parsing for non-standard or partially copied URLs
          const rawTokenMatch = trimmedUrl.match(/(?:id_token|code)=([^&]+)/);
          if (rawTokenMatch) {
            token = decodeURIComponent(rawTokenMatch[1]);
          }
        }
      }

      token = (token || "").trim();

      if (token) {
        setOauthStatus("Google ID token parsed! Exchanging and validating connection...");
        setValidating(true);
        setValidationResult(null);

        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey: token,
          }),
        });

        const data = await res.json();
        const isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
        if (isValid && data.apiKey) {
          setFormData(prev => ({
            ...prev,
            name: `Kimi Google Account`,
            apiKey: data.apiKey,
          }));
          setOauthStatus("Login and validation successful!");
          setKimiOauthStep("idle");
          setKimiCallbackUrl("");
        } else {
          setOauthStatus("Validation failed: Google token exchange did not yield a valid Kimi access token.");
        }
      } else {
        setOauthStatus("No id_token found in the pasted URL. Please ensure you copied the complete redirected URL.");
      }
    } catch (err) {
      console.error("Kimi callback parse error:", err);
      setOauthStatus(`Failed to process URL: ${err.message || String(err)}`);
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };



  const buildProviderSpecificData = () => {
    if (isOllamaLocal && formData.ollamaHostUrl.trim()) {
      return { baseUrl: formData.ollamaHostUrl.trim() };
    }
    if (isAzure) {
      return {
        azureEndpoint: azureData.azureEndpoint,
        apiVersion: azureData.apiVersion,
        deployment: azureData.deployment,
        organization: azureData.organization,
      };
    }
    if (isCloudflareAi) {
      return { accountId: cloudflareData.accountId };
    }
    if (isDeepseekFree) {
      return { username: deepseekFreeData.username };
    }

    if (providerRegions && region) {
      return { region };
    }
    return undefined;
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: formData.apiKey,
          providerSpecificData: {
            ...buildProviderSpecificData(),
            proxyPoolId: formData.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : formData.proxyPoolId,
          },
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
      if (data.valid && data.apiKey) {
        setFormData(prev => ({ ...prev, apiKey: data.apiKey }));
      }
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider) return;
    if (!isOllamaLocal && !formData.apiKey) return;
    if (!isOllamaLocal) {
      // Non-ollama providers require a name
      if (!formData.name) return;
    }
    if (isCompatible && !formData.defaultModel.trim()) return;

    setSaving(true);
    try {
      let isValid = false;
      let finalApiKey = formData.apiKey;
      try {
        setValidating(true);
        setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey: formData.apiKey,
            providerSpecificData: {
              ...buildProviderSpecificData(),
              proxyPoolId: formData.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : formData.proxyPoolId,
            },
          }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        if (data.apiKey) {
          finalApiKey = data.apiKey;
        }
        setValidationResult(isValid ? "success" : "failed");
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }

      await onSave({
        name: formData.name || (isOllamaLocal ? "Ollama Local" : ""),
        apiKey: finalApiKey,
        defaultModel: isCompatible ? formData.defaultModel.trim() : undefined,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
        providerSpecificData: buildProviderSpecificData()
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSubmit = async () => {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setSaving(true);
    setBulkResult(null);
    let success = 0;
    let failed = 0;
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("|");
      const apiKey = parts.length >= 2 ? parts.slice(1).join("|").trim() : parts[0].trim();
      const baseName = parts.length >= 2 ? parts[0].trim() : "Key";
      const name = `${baseName} ${i + 1}`;
      try {
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey, name, priority: 1, testStatus: "unknown" }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setSaving(false);
    setBulkResult({ success, failed });
    if (success > 0 && onBulkDone) onBulkDone();
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} ${credentialLabel}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Mode switcher */}
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "single" ? "primary" : "ghost"} onClick={() => { setMode("single"); setBulkResult(null); }}>Single</Button>
          <Button size="sm" variant={mode === "bulk" ? "primary" : "ghost"} onClick={() => { setMode("bulk"); setBulkResult(null); }}>Bulk Add</Button>
        </div>

        {mode === "bulk" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">One key per line. Format: <code>name|apiKey</code> or just <code>apiKey</code> (auto-named by index).</p>
            <textarea
              className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[140px] focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={BULK_PLACEHOLDER}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            {bulkResult && (
              <div className={`text-sm font-medium ${bulkResult.failed > 0 ? "text-yellow-400" : "text-green-400"}`}>
                ✓ {bulkResult.success} added{bulkResult.failed > 0 ? `, ✗ ${bulkResult.failed} failed` : ""}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleBulkSubmit} fullWidth disabled={saving || !bulkText.trim()}>
                {saving ? "Adding..." : "Add All Keys"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
            </div>
          </div>
        )}

        {mode === "single" && (<>
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOllamaLocal ? "Ollama Local" : "Production Key"}
        />
        {isOllamaLocal && (
          <div className="flex gap-2">
            <Input
              label="Ollama Host URL"
              value={formData.ollamaHostUrl}
              onChange={(e) => setFormData({ ...formData, ollamaHostUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="flex-1"
            />
            <div className="pt-6">
              <Button onClick={handleValidate} disabled={validating || saving} variant="secondary">
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {!isOllamaLocal && (
          <div className="flex gap-2">
            <Input
              label={credentialLabel}
              type={isCookie ? "text" : "password"}
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder={credentialPlaceholder}
              className="flex-1"
            />
            <div className="pt-6">
              <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {isXaiApiKey && (
          <p className="text-xs text-text-muted">
            Use a direct xAI API key from console.x.ai. This is separate from Grok Build OAuth.
          </p>
        )}
        {isCookie && authHint && (
          <p className="text-xs text-text-muted">
            {authHint}
            {website && (
              <>
                {" "}
                <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Open {website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </p>
        )}
        {providerRegions && (
          <Select
            label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            options={providerRegions.map((r) => ({ value: r.id, label: r.label }))}
          />
        )}
        {isCompatible && (
          <Input
            label="Default Model"
            value={formData.defaultModel}
            onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
            placeholder={isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
          />
        )}
        {isOllamaLocal && (
          <p className="text-xs text-text-muted">
            Leave blank to use <code>http://localhost:11434</code>. For remote Ollama, enter the full host URL (e.g. <code>http://192.168.1.10:11434</code>).
          </p>
        )}
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        {error && (
          <p className="text-xs text-red-500 break-words">{error}</p>
        )}
        {isCompatible && (
          <p className="text-xs text-text-muted">
            Enter the model ID exactly as your compatible endpoint expects it. This model will be saved as the connection default.
          </p>
        )}
        {isDeepseekFree && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">DeepSeek Account Details</h3>
            <Input
              label="Username (Email or Mobile)"
              value={deepseekFreeData.username}
              onChange={(e) => setDeepseekFreeData({ ...deepseekFreeData, username: e.target.value })}
              placeholder="example@email.com or +8613800000000"
            />
            <p className="text-xs text-text-muted mt-2">
              Enter your deepseek.com login email or mobile number (include country code like +86).
            </p>
          </div>
        )}

        {isKimiFree && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20 flex flex-col gap-3">
            <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded-lg text-xs text-blue-300 leading-relaxed">
              <strong className="text-blue-400 block mb-1">📋 Kimi Web Chat Free Tier Limits (2026)</strong>
              <div className="overflow-x-auto mt-1.5">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-blue-500/20 text-text-muted">
                      <th className="py-1 pr-2">Feature</th>
                      <th className="py-1 pr-2">Free Tier Limit</th>
                      <th className="py-1">Reset Frequency</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-blue-500/10">
                      <td className="py-1 pr-2">Daily Messages</td>
                      <td className="py-1 pr-2">~30 to 50 messages/day</td>
                      <td className="py-1">Every 24 hours</td>
                    </tr>
                    <tr className="border-b border-blue-500/10">
                      <td className="py-1 pr-2">Context Window</td>
                      <td className="py-1 pr-2">128K ~ 256K tokens</td>
                      <td className="py-1">-</td>
                    </tr>
                    <tr className="border-b border-blue-500/10">
                      <td className="py-1 pr-2">Model</td>
                      <td className="py-1 pr-2">Kimi K2 / K2.6 (limited mode)</td>
                      <td className="py-1">-</td>
                    </tr>
                    <tr>
                      <td className="py-1 pr-2">Agent Usage</td>
                      <td className="py-1 pr-2">1 concurrent task</td>
                      <td className="py-1">6 total tasks limit</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <h3 className="font-semibold text-sm">Kimi Google Login</h3>
            <div className="flex flex-col gap-2 mt-1">
              <Button
                onClick={handleKimiGoogleLogin}
                disabled={oauthLoading || validating || saving}
                className="flex items-center justify-center gap-3 w-full"
                variant="primary"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.137 4.114-3.468 0-6.273-2.805-6.273-6.273s2.805-6.273 6.273-6.273c1.582 0 2.983.587 4.058 1.548l3.056-3.056C19.006 1.83 15.932 1 12.24 1h-.08C5.973 1 1 5.973 1 12.16S5.973 23 12.16 23c6.082 0 10.84-4.298 10.84-10.84 0-.677-.07-1.348-.16-1.875H12.24z"/>
                </svg>
                Open Kimi Google Sign-in
              </Button>
            </div>

            {kimiOauthStep === "input" && (
              <div className="flex flex-col gap-2 mt-2">
                <p className="text-xs font-semibold text-text-primary">
                  Step 2: Paste the callback URL here
                </p>
                <p className="text-[11px] text-text-muted">
                  After logging in via Google, copy the full URL from your browser address bar (it will start with <code>https://www.kimi.com/google-callback#...</code>) and paste it below.
                </p>
                <Input
                  value={kimiCallbackUrl}
                  onChange={(e) => handleKimiCallbackUrlChange(e.target.value)}
                  placeholder="https://www.kimi.com/google-callback#iss=..."
                  className="font-mono text-xs"
                />
              </div>
            )}
            
            {oauthStatus && (
              <p className="text-xs text-text-muted mt-1 text-center bg-sidebar p-2 rounded border border-accent/10">
                {oauthStatus}
              </p>
            )}

            <div className="border-t border-border/60 my-2 pt-2">
              <p className="text-xs text-text-dim text-center">
                — OR ENTER KEY/TOKEN MANUALLY —
              </p>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2.5 rounded text-xs text-yellow-300 leading-relaxed">
              <strong>💡 Paste Access Token, Refresh Token, or Cookie:</strong>
              <ol className="list-decimal list-inside mt-1 gap-1 flex flex-col">
                <li>Log in to <a href="https://www.kimi.com" target="_blank" rel="noopener noreferrer" className="text-primary underline font-semibold">Kimi Chat (Global)</a> or <a href="https://kimi.moonshot.cn" target="_blank" rel="noopener noreferrer" className="text-primary underline font-semibold">Kimi Chat (CN)</a> in your browser. You can log in via Google or any other social/email method.</li>
                <li>Open Developer Tools (F12 or right-click -&gt; Inspect).</li>
                <li>Go to the <strong>Application</strong> (or Storage) tab.</li>
                <li><strong>Either:</strong> Under <strong>Local Storage</strong> for the site, find the key <code>refresh_token</code> or <code>access_token</code> and copy its value.</li>
                <li><strong>Or:</strong> Under <strong>Cookies</strong> for the site, find the cookie named <code>kimi-auth</code> and copy its value.</li>
                <li>Paste the copied token (starts with <code>eyJ...</code>) in the <strong>Kimi Web Token</strong> field above, and click <strong>Check</strong>!</li>
              </ol>
            </div>
          </div>
        )}

        {provider === "grok-free" && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20 flex flex-col gap-3">
            <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded-lg text-xs text-blue-300 leading-relaxed">
              <div className="flex items-center justify-between mb-1">
                <strong className="text-blue-400">📋 Grok Free Tier Limits (console.x.ai)</strong>
                <Badge variant="success" className="!bg-amber-500/10 !text-amber-500 border border-amber-500/20 text-[10px] py-0 px-1.5 rounded-full font-medium flex items-center gap-0.5 shrink-0">
                  🔥 Fastest
                </Badge>
              </div>
              <div className="overflow-x-auto mt-1.5">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-blue-500/20 text-text-muted">
                      <th className="py-1 pr-2">Feature</th>
                      <th className="py-1 pr-2">Free Tier Limit</th>
                      <th className="py-1">Reset Frequency</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-blue-500/10">
                      <td className="py-1 pr-2">Grok 4.3 Console</td>
                      <td className="py-1 pr-2">~20 to 50 messages/day</td>
                      <td className="py-1">Every 24 hours</td>
                    </tr>
                    <tr className="border-b border-blue-500/10">
                      <td className="py-1 pr-2">Context Window</td>
                      <td className="py-1 pr-2">Up to 1,000,000 tokens</td>
                      <td className="py-1">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2.5 rounded text-xs text-yellow-300 leading-relaxed">
              <strong className="text-red-400 block mb-1">⚠️ Important Proxy Requirement:</strong>
              <p className="mb-2 text-text-muted">
                Cloudflare blocks direct server connections to console.x.ai (resulting in 403).
                <strong> You MUST select a working Proxy Pool (e.g. Vercel or Cloudflare relay) in the Proxy Pool dropdown below</strong> before clicking Check or Save, otherwise validation will fail.
              </p>
              <strong className="block mt-2 mb-1">💡 How to extract your SSO cookie:</strong>
              <ol className="list-decimal list-inside mt-1 gap-1 flex flex-col">
                <li>Log in to <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline font-semibold">console.x.ai</a> in your browser.</li>
                <li>Open Developer Tools (F12 or right-click -&gt; Inspect).</li>
                <li>Go to the <strong>Application</strong> (or Storage) tab.</li>
                <li>Under <strong>Cookies</strong> for the site, find the cookie named <code>sso</code> and copy its value.</li>
                <li>Paste the copied cookie value (starts with <code>sso=...</code> or just the raw token) in the <strong>Cookie Value</strong> field above, and click <strong>Check</strong>! <strong>(If validation shows Invalid, try changing the proxy in the Proxy Pool dropdown below.)</strong></li>
              </ol>
            </div>
          </div>
        )}
        {isCloudflareAi && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Cloudflare Workers AI</h3>
            <Input
              label="Account ID"
              value={cloudflareData.accountId}
              onChange={(e) => setCloudflareData({ ...cloudflareData, accountId: e.target.value })}
              placeholder="abc123def456..."
            />
            <p className="text-xs text-text-muted mt-2">
              Find your Account ID in the right sidebar of <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">dash.cloudflare.com</a>
            </p>
          </div>
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
              />
              <Input
                label="Deployment Name"
                value={azureData.deployment}
                onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })}
                placeholder="gpt-4"
              />
              <Input
                label="API Version"
                value={azureData.apiVersion}
                onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })}
                placeholder="2024-10-01-preview"
              />
              <Input
                label="Organization"
                value={azureData.organization}
                onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })}
                placeholder="Organization ID"
              />
            </div>
          </div>
        )}

        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />

        <Select
          label="Proxy Pool"
          value={formData.proxyPoolId}
          onChange={(e) => setFormData({ ...formData, proxyPoolId: e.target.value })}
          options={[
            { value: NONE_PROXY_POOL_VALUE, label: "None" },
            ...(proxyPools || []).map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
          placeholder="None"
        />

        {(proxyPools || []).length === 0 && (
          <p className="text-xs text-text-muted">
            No active proxy pools available. Create one in Proxy Pools page first.
          </p>
        )}

        <p className="text-xs text-text-muted">
          Legacy manual proxy fields are still accepted by API for backward compatibility.
        </p>

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving || (!isOllamaLocal && (!formData.name || !formData.apiKey)) || (isCompatible && !formData.defaultModel.trim()) || (isAzure && (!azureData.azureEndpoint || !azureData.deployment || !azureData.organization)) || (isCloudflareAi && !cloudflareData.accountId) || (isDeepseekFree && !deepseekFreeData.username)}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
        </>)}
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  isCompatible: PropTypes.bool,
  isAnthropic: PropTypes.bool,
  authType: PropTypes.string,
  authHint: PropTypes.string,
  website: PropTypes.string,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  })),
  error: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  onBulkDone: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
