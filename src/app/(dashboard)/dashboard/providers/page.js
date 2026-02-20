"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import PropTypes from "prop-types";
import { Card, CardSkeleton, Badge, Button, Input, Modal, Select } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_PROVIDERS, OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import Link from "next/link";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { useLocale, useTranslations } from "next-intl";

// Shared helper function to avoid code duplication between ProviderCard and ApiKeyProviderCard
function getStatusDisplay(connected, error, errorCode, t) {
  const parts = [];
  if (connected > 0) {
    parts.push(
      <Badge key="connected" variant="success" size="sm" dot>
        {t("providers.connected", { count: connected })}
      </Badge>
    );
  }
  if (error > 0) {
    const errText = errorCode
      ? t("providers.errorWithCode", { count: error, code: errorCode })
      : t("providers.error", { count: error });
    parts.push(
      <Badge key="error" variant="error" size="sm" dot>
        {errText}
      </Badge>
    );
  }
  if (parts.length === 0) {
    return <span className="text-text-muted">{t("providers.noConnections")}</span>;
  }
  return parts;
}

export default function ProvidersPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [connectionsRes, nodesRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
        ]);
        const connectionsData = await connectionsRes.json();
        const nodesData = await nodesRes.json();
        if (connectionsRes.ok) setConnections(connectionsData.connections || []);
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
      } catch (error) {
        console.log("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getProviderStats = (providerId, authType) => {
    const providerConnections = connections.filter(
      c => c.provider === providerId && c.authType === authType
    );

    // Helper: check if connection is effectively active (cooldown expired)
    const getEffectiveStatus = (conn) => {
      const isCooldown = conn.rateLimitedUntil && new Date(conn.rateLimitedUntil).getTime() > Date.now();
      return (conn.testStatus === "unavailable" && !isCooldown) ? "active" : conn.testStatus;
    };

    const connected = providerConnections.filter(c => {
      const status = getEffectiveStatus(c);
      return status === "active" || status === "success";
    }).length;

    const errorConns = providerConnections.filter(c => {
      const status = getEffectiveStatus(c);
      return status === "error" || status === "expired" || status === "unavailable";
    });

    const error = errorConns.length;
    const total = providerConnections.length;

    // Get latest error info
    const latestError = errorConns.sort((a, b) =>
      new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0)
    )[0];
    const errorCode = latestError ? getErrorCode(latestError.lastError) : null;
    const errorTime = latestError?.lastErrorAt ? getRelativeTime(latestError.lastErrorAt, {
      locale,
      messages: {
        justNow: t("providers.time.justNow"),
        minutesAgo: (count) => t("providers.time.minutesAgo", { count }),
        hoursAgo: (count) => t("providers.time.hoursAgo", { count }),
        daysAgo: (count) => t("providers.time.daysAgo", { count }),
      },
    }) : null;

    return { connected, error, total, errorCode, errorTime };
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
        name: node.name || t("providers.openaiCompatible"),
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }));

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
        name: node.name || t("providers.anthropicCompatible"),
      color: "#D97757",
      textIcon: "AC",
    }));

  const apiKeyProviders = {
    ...APIKEY_PROVIDERS,
    ...compatibleProviders.reduce((acc, provider) => {
      acc[provider.id] = provider;
      return acc;
    }, {}),
    ...anthropicCompatibleProviders.reduce((acc, provider) => {
      acc[provider.id] = provider;
      return acc;
    }, {}),
  };

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
      {/* OAuth Providers */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("providers.oauthTitle")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(OAUTH_PROVIDERS).map(([key, info]) => (
            <ProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "oauth")}
            />
          ))}
        </div>
      </div>

      {/* Free Providers */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("providers.freeTitle")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(FREE_PROVIDERS).map(([key, info]) => (
            <ProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "oauth")}
            />
          ))}
        </div>
      </div>

      {/* API Key Providers */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{t("providers.apiKeyTitle")}</h2>
          <div className="flex gap-2">
            <Button size="sm" icon="add" onClick={() => setShowAddAnthropicCompatibleModal(true)}>
              {t("providers.addAnthropic")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="!bg-white !text-black hover:!bg-gray-100"
            >
              {t("providers.addOpenAI")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(apiKeyProviders).map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
            />
          ))}
        </div>
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
    </div>
  );
}

function ProviderCard({ providerId, provider, stats }) {
  const t = useTranslations();
  const { connected, error, errorCode, errorTime } = stats;
  const [imgError, setImgError] = useState(false);

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group">
      <Card padding="xs" className="h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="size-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${provider.color}15` }}
            >
              {imgError ? (
                <span
                  className="text-xs font-bold"
                  style={{ color: provider.color }}
                >
                  {provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <Image
                  src={`/providers/${provider.id}.png`}
                  alt={provider.name}
                  width={30}
                  height={30}
                  className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                  sizes="32px"
                  onError={() => setImgError(true)}
                />
              )}
            </div>
            <div>
              <h3 className="font-semibold">{provider.name}</h3>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {getStatusDisplay(connected, error, errorCode, t)}
                {errorTime && <span className="text-text-muted">• {errorTime}</span>}
              </div>
            </div>
          </div>
          <span className="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            chevron_right
          </span>
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
};

// API Key providers - use image with textIcon fallback (same as OAuth providers)
function ApiKeyProviderCard({ providerId, provider, stats }) {
  const t = useTranslations();
  const { connected, error, errorCode, errorTime } = stats;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
  const [imgError, setImgError] = useState(false);

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getIconPath = () => {
    if (isCompatible) {
      return provider.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png"; // Use Anthropic icon as base
    }
    return `/providers/${provider.id}.png`;
  };

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group">
      <Card padding="xs" className="h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="size-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${provider.color}15` }}
            >
              {imgError ? (
                <span
                  className="text-xs font-bold"
                  style={{ color: provider.color }}
                >
                  {provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <Image
                  src={getIconPath()}
                  alt={provider.name}
                  width={30}
                  height={30}
                  className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                  sizes="30px"
                  onError={() => setImgError(true)}
                />
              )}
            </div>
            <div>
              <h3 className="font-semibold">{provider.name}</h3>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                {getStatusDisplay(connected, error, errorCode, t)}
                {isCompatible && (
                  <Badge variant="default" size="sm">
                    {provider.apiType === "responses" ? t("providers.apiTypeResponses") : t("providers.apiTypeChat")}
                  </Badge>
                )}
                {isAnthropicCompatible && (
                  <Badge variant="default" size="sm">
                    {t("providers.apiTypeMessages")}
                  </Badge>
                )}
                {errorTime && <span className="text-text-muted">• {errorTime}</span>}
              </div>
            </div>
          </div>
          <span className="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            chevron_right
          </span>
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
};

function AddOpenAICompatibleModal({ isOpen, onClose, onCreated }) {
  const t = useTranslations();
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const apiTypeOptions = [
    { value: "chat", label: t("providers.apiTypeChatCompletions") },
    { value: "responses", label: t("providers.apiTypeResponsesApi") },
  ];

  useEffect(() => {
    const defaultBaseUrl = "https://api.openai.com/v1";
    setFormData((prev) => ({
      ...prev,
      baseUrl: defaultBaseUrl,
    }));
  }, [formData.apiType]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
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
        body: JSON.stringify({ baseUrl: formData.baseUrl, apiKey: checkKey, type: "openai-compatible" }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title={t("providers.addOpenAITitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label={t("providers.form.name")}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={t("providers.form.openaiNamePlaceholder")}
          hint={t("providers.form.requiredLabel")}
        />
        <Input
          label={t("providers.form.prefix")}
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={t("providers.form.openaiPrefixPlaceholder")}
          hint={t("providers.form.prefixHint")}
        />
        <Select
          label={t("providers.form.apiType")}
          options={apiTypeOptions}
          value={formData.apiType}
          onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
        />
        <Input
          label={t("providers.form.baseUrl")}
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={t("providers.form.openaiBaseUrlPlaceholder")}
          hint={t("providers.form.openaiBaseUrlHint")}
        />
        <div className="flex gap-2">
          <Input
            label={t("providers.form.checkKey")}
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? t("providers.form.checking") : t("providers.form.check")}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? t("providers.form.valid") : t("providers.form.invalid")}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}>
            {submitting ? t("providers.form.creating") : t("providers.form.create")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {t("common.cancel")}
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
  const t = useTranslations();
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: "https://api.anthropic.com/v1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    // Reset validation when modal opens
    if (isOpen) {
      setValidationResult(null);
      setCheckKey("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
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
          type: "anthropic-compatible" 
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

  return (
    <Modal isOpen={isOpen} title={t("providers.addAnthropicTitle")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label={t("providers.form.name")}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={t("providers.form.anthropicNamePlaceholder")}
          hint={t("providers.form.requiredLabel")}
        />
        <Input
          label={t("providers.form.prefix")}
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={t("providers.form.anthropicPrefixPlaceholder")}
          hint={t("providers.form.prefixHint")}
        />
        <Input
          label={t("providers.form.baseUrl")}
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={t("providers.form.anthropicBaseUrlPlaceholder")}
          hint={t("providers.form.anthropicBaseUrlHint")}
        />
        <div className="flex gap-2">
          <Input
            label={t("providers.form.checkKey")}
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? t("providers.form.checking") : t("providers.form.check")}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? t("providers.form.valid") : t("providers.form.invalid")}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}>
            {submitting ? t("providers.form.creating") : t("providers.form.create")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            {t("common.cancel")}
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
