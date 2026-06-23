"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import type { ComponentType, ReactNode, ButtonHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Card as _Card,
  Button as _Button,
  Badge,
  Input as _Input,
  Modal as _Modal,
  CardSkeleton,
  OAuthModal,
  KiroOAuthWrapper,
  CursorAuthModal,
  IFlowCookieModal,
  GitLabAuthModal,
  Toggle as _Toggle,
  Select as _Select,
  EditConnectionModal,
  NoAuthProxyCard,
  ConfirmModal as _ConfirmModal,
} from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS, THINKING_CONFIG } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { translate } from "@/i18n/runtime";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import ModelRow from "./ModelRow";
import PassthroughModelsSection from "./PassthroughModelsSection";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import AddApiKeyModal from "./AddApiKeyModal";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import AddCustomModelModal from "./AddCustomModelModal";
import BulkImportCodexModal from "./BulkImportCodexModal";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import type { ProviderNode } from "@/lib/db/repos/nodesRepo";
import type { ProxyPool } from "@/lib/db/repos/proxyPoolsRepo";
import type { JsonValue } from "open-sse/types/executor.js";
// ---------------------------------------------------------------------------
// Typed shims — JS shared components lack TS declarations
// ---------------------------------------------------------------------------
interface AutoPingProp { on: boolean; onToggle: (on: boolean) => void; }
interface OneByOneStatusProp { state: string; error: string | null; }
interface ConnectionRowProps {
  connection: ProviderConnection; proxyPools: ProxyPool[]; isOAuth: boolean;
  isFirst: boolean; isLast: boolean;
  onMoveUp: () => void; onMoveDown: () => void;
  onToggleActive: (isActive: boolean) => void;
  autoPing?: AutoPingProp | null;
  onUpdateProxy: (proxyPoolId: string) => Promise<void>;
  onEdit: () => void; onDelete: () => void;
  oneByOneStatus?: OneByOneStatusProp | null;
}
const ConnectionRowTyped = ConnectionRow as ComponentType<ConnectionRowProps>;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode; variant?: string; icon?: string; size?: string;
  loading?: boolean | undefined; fullWidth?: boolean; title?: string; className?: string;
}
interface CardProps { children?: ReactNode; title?: string; subtitle?: string; icon?: string; action?: ReactNode; padding?: string; hover?: boolean; elev?: boolean; className?: string; }
interface InputProps {
  label?: string; value?: string | number; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string; hint?: ReactNode; icon?: string; inputClassName?: string;
  type?: string; placeholder?: string; min?: number; max?: number; disabled?: boolean;
}
interface ToggleProps { checked?: boolean; onChange?: (v?: boolean) => void; disabled?: boolean; size?: string; className?: string; }
interface SelectProps { value?: string; onChange?: (v: string) => void; options?: { value: string; label: string }[]; className?: string; disabled?: boolean; }
interface ModalProps { isOpen?: boolean; onClose?: () => void; title?: string; children?: ReactNode; footer?: ReactNode; size?: string; }
interface ConfirmModalProps {
  isOpen?: boolean; onClose?: () => void; onConfirm?: (() => void) | (() => Promise<void>) | undefined;
  title?: string; message?: string | null | undefined; confirmText?: string; cancelText?: string; variant?: string; loading?: boolean;
}
interface OAuthModalProps {
  isOpen?: boolean; provider?: string; providerInfo?: JsonValue | null;
  onSuccess?: () => void; onClose?: () => void;
  oauthMeta?: JsonValue | null; idcConfig?: JsonValue | null;
}
const Button            = _Button       as ComponentType<ButtonProps>;
const Card              = _Card         as ComponentType<CardProps>;
const Input             = _Input        as ComponentType<InputProps>;
const Toggle            = _Toggle       as ComponentType<ToggleProps>;
const Select            = _Select       as ComponentType<SelectProps>;
const Modal             = _Modal        as ComponentType<ModalProps>;
const ConfirmModal      = _ConfirmModal as ComponentType<ConfirmModalProps>;
const OAuthModalTyped   = OAuthModal   as ComponentType<OAuthModalProps>;

// ---------------------------------------------------------------------------
// Page-local interfaces
// ---------------------------------------------------------------------------
interface AutoPingState { enabled: boolean; connections: Record<string, boolean | undefined>; }
interface OneByOneResult { state: "queued" | "testing" | "success" | "failed"; error: string | null; }
interface OneByOneSummary { total: number; completed: number; passed: number; failed: number; stopped: boolean; }
interface ConfirmState { title: string; message: string; onConfirm: () => void | Promise<void>; }
interface SuggestedModel { id: string; name: string; contextLength: number; }
interface ModelsFetcher { url: string; type: string; }
interface ThinkingConfig { options: string[]; defaultMode: string; defaultBudgetTokens?: number; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function asJson(res: Response): Promise<JsonValue> { return res.json() as Promise<JsonValue>; }
function strOf(v: JsonValue | undefined): string | undefined { return typeof v === "string" ? v : undefined; }
function numOf(v: JsonValue | undefined): number | undefined { return typeof v === "number" ? v : undefined; }
function boolOf(v: JsonValue | undefined): boolean | undefined { return typeof v === "boolean" ? v : undefined; }
function recOf(v: JsonValue | undefined): Record<string, JsonValue> {
  return (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) ? (v as Record<string, JsonValue>) : {};
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
const ONE_BY_ONE_DELAY_MS = 1000;
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export default function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: providerId } = use(params);
  const router = useRouter();
  const { getCaps } = useModelCaps();
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState<ProviderNode | null>(null);
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<ProviderConnection | null>(null);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [headerImgError, setHeaderImgError] = useState(false);
  const [modelTestResults, setModelTestResults] = useState<Record<string, string>>({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(() => new Set());
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [providerStrategy, setProviderStrategy] = useState<string | null>(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [autoPing, setAutoPing] = useState<AutoPingState>({ enabled: false, connections: {} });
  const [suggestedModels, setSuggestedModels] = useState<SuggestedModel[]>([]);
  const [kiloFreeModels, setKiloFreeModels] = useState<{ id: string; isFree?: boolean }[]>([]);
  const [disabledModelIds, setDisabledModelIds] = useState<string[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState(false);
  const [oneByOneRunning, setOneByOneRunning] = useState(false);
  const [oneByOneStopping, setOneByOneStopping] = useState(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState<string | null>(null);
  const [oneByOneResults, setOneByOneResults] = useState<Record<string, OneByOneResult>>({});
  const [oneByOneSummary, setOneByOneSummary] = useState<OneByOneSummary | null>(null);
  const stopOneByOneRef = useRef(false);
  const [importingQoderModels, setImportingQoderModels] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

  // ---------------------------------------------------------------------------
  // Derived provider info
  // ---------------------------------------------------------------------------
  const providerInfo = providerNode
    ? {
        id: providerNode["id"] as string,
        name: (providerNode["name"] as string | null) || (providerNode["type"] === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: providerNode["type"] === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode["type"] === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode["apiType"] as string | undefined,
        baseUrl: providerNode["baseUrl"] as string | undefined,
        type: providerNode["type"] as string | null,
        prefix: providerNode["prefix"] as string | undefined,
        passthroughModels: providerNode["passthroughModels"] as boolean | undefined,
        deprecated: false as boolean | undefined,
        deprecationNotice: undefined as string | undefined,
        notice: undefined as { text?: string; apiKeyUrl?: string; signupUrl?: string } | undefined,
        website: undefined as string | undefined,
        authModes: [] as string[],
        authType: undefined as string | undefined,
        authHint: undefined as string | undefined,
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]) as {
        id?: string; name?: string; color?: string; textIcon?: string; apiType?: string; baseUrl?: string; type?: string | null;
        prefix?: string; passthroughModels?: boolean; deprecated?: boolean; deprecationNotice?: string;
        notice?: { text?: string; apiKeyUrl?: string; signupUrl?: string }; website?: string;
        authModes?: string[]; authType?: string; authHint?: string; noAuth?: boolean;
      } | undefined;
  const authModes: string[] = (providerInfo as { authModes?: string[] } | undefined)?.authModes ?? [];
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!FREE_PROVIDERS[providerId] || authModes.includes("oauth");
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const isFreeNoAuth = !!(FREE_PROVIDERS[providerId] as { noAuth?: boolean } | undefined)?.noAuth;
  const models = getModelsByProviderId(providerId) as { id: string; isFree?: boolean }[];
  const providerAlias = getProviderAlias(providerId) as string;
  const isOpenAICompatible = isOpenAICompatibleProvider(providerId) as boolean;
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId) as boolean;
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  const oauthConnectionLabel = providerId === "xai" ? "Grok Build OAuth" : "OAuth";
  const apiKeyConnectionLabel = providerId === "xai" ? "xAI API Key" : "API Key";
  const thinkingConfig = (AI_PROVIDERS as Record<string, { thinkingConfig?: ThinkingConfig }>)[providerId]?.thinkingConfig ?? THINKING_CONFIG.extended as ThinkingConfig;
  void thinkingConfig;
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible
    ? ((providerNode?.["prefix"] as string | undefined) ?? providerId)
    : providerAlias;

  // ---------------------------------------------------------------------------
  // Early handlers
  // ---------------------------------------------------------------------------
  const openOAuthConnection = () => { setShowOAuthModal(true); };

  const triggerOAuthConnection = () => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed = window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) { setShowAgRiskModal(true); return; }
    }
    if (isOAuth) { openOAuthConnection(); return; }
    setAddConnectionError(""); setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => { setAddConnectionError(""); setShowAddApiKeyModal(true); };

  const triggerAddConnection = () => {
    if (isOAuth) { triggerOAuthConnection(); return; }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = () => {
    if (typeof window !== "undefined") window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    setShowAgRiskModal(false);
    if (isOAuth) { openOAuthConnection(); return; }
    triggerApiKeyConnection();
  };

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------
  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" });
      const data = await asJson(res);
      if (res.ok) setDisabledModelIds((recOf(data)["ids"] as string[] | undefined) ?? []);
    } catch (error) { console.log("Error fetching disabled models:", error); }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) { console.log("Error disabling model:", error); }
  };

  const handleEnableModel = async (modelId: string) => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) { console.log("Error enabling model:", error); }
  };

  const handleDisableAll = async (ids: string[]) => {
    if (!ids.length) return;
    setConfirmState({
      title: "Disable All Models", message: `Disable all ${ids.length} model(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch("/api/models/disabled", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
          });
          if (res.ok) await fetchDisabledModels();
        } catch (error) { console.log("Error disabling all models:", error); }
      },
    });
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) { console.log("Error enabling all models:", error); }
  };

  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await asJson(res);
      if (res.ok) setModelAliases((recOf(data)["aliases"] as Record<string, string> | undefined) ?? {});
    } catch (error) { console.log("Error fetching aliases:", error); }
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await asJson(connectionsRes);
      const nodesData = await asJson(nodesRes);
      const proxyPoolsData = await asJson(proxyPoolsRes);
      const settingsData = settingsRes.ok ? await asJson(settingsRes) : {} as JsonValue;
      if (connectionsRes.ok) {
        const all = (recOf(connectionsData)["connections"] as ProviderConnection[] | undefined) ?? [];
        setConnections(all.filter((c) => c.provider === providerId));
      }
      if (proxyPoolsRes.ok) {
        setProxyPools((recOf(proxyPoolsData)["proxyPools"] as ProxyPool[] | undefined) ?? []);
      }
      const sd = recOf(settingsData);
      const override = recOf((recOf(sd["providerStrategies"] as JsonValue))[ providerId] as JsonValue | undefined);
      setProviderStrategy(strOf(override["fallbackStrategy"]) ?? null);
      setProviderStickyLimit(override["stickyRoundRobinLimit"] != null ? String(override["stickyRoundRobinLimit"]) : "1");
      const thinkingCfg = recOf((recOf(sd["providerThinking"] as JsonValue))[providerId] as JsonValue | undefined);
      setThinkingMode(strOf(thinkingCfg["mode"]) ?? "auto");
      const apCfg = recOf(sd["claudeAutoPing"] as JsonValue | undefined);
      setAutoPing({ enabled: boolOf(apCfg["enabled"]) === true, connections: (recOf(apCfg["connections"] as JsonValue | undefined)) as Record<string, boolean | undefined> });
      if (nodesRes.ok) {
        const nodeList = (recOf(nodesData)["nodes"] as ProviderNode[] | undefined) ?? [];
        let node: ProviderNode | null = nodeList.find((e) => e.id === providerId) ?? null;
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await asJson(retryRes);
            node = ((recOf(retryData)["nodes"] as ProviderNode[] | undefined) ?? []).find((e) => e.id === providerId) ?? null;
            if (node) break;
          }
        }
        setProviderNode(node);
      }
    } catch (error) { console.log("Error fetching connections:", error); }
    finally { setLoading(false); }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData: Record<string, JsonValue>) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData),
      });
      const data = await asJson(res);
      if (res.ok) {
        const nodeRec = recOf(data)["node"];
        if (nodeRec !== null && typeof nodeRec === "object" && !Array.isArray(nodeRec)) {
          // ProviderNode extends Record<string,JsonValue> structurally — cast via shared base
          setProviderNode((nodeRec as Record<string, JsonValue>) as ProviderNode);
        }
        await fetchConnections(); setShowEditNodeModal(false);
      }
    } catch (error) { console.log("Error updating provider node:", error); }
  };

  const saveProviderStrategy = async (strategy: string | null, stickyLimit: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await asJson(settingsRes) : {} as JsonValue;
      const current = recOf(recOf(settingsData)["providerStrategies"] as JsonValue | undefined);
      const override: Record<string, JsonValue> = {};
      if (strategy) override["fallbackStrategy"] = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") override["stickyRoundRobinLimit"] = Number(stickyLimit) || 3;
      const updated = { ...current };
      if (Object.keys(override).length === 0) { delete updated[providerId]; } else { updated[providerId] = override; }
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
    } catch (error) { console.log("Error saving provider strategy:", error); }
  };

  const handleRoundRobinToggle = (enabled?: boolean) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy); saveProviderStrategy(strategy, sticky);
  };
  const handleStickyLimitChange = (value: string) => { setProviderStickyLimit(value); saveProviderStrategy("round-robin", value); };

  const saveThinkingConfig = async (mode: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await asJson(settingsRes) : {} as JsonValue;
      const current = recOf(recOf(settingsData)["providerThinking"] as JsonValue | undefined);
      const updated = { ...current };
      if (!mode || mode === "auto") { delete updated[providerId]; } else { updated[providerId] = { mode } as Record<string, JsonValue>; }
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerThinking: updated }) });
    } catch (error) { console.log("Error saving thinking config:", error); }
  };
  const handleThinkingModeChange = (mode: string) => { setThinkingMode(mode); saveThinkingConfig(mode); };

  const saveAutoPing = async (next: AutoPingState) => {
    setAutoPing(next);
    try { await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claudeAutoPing: next }) }); }
    catch (error) { console.log("Error saving auto-ping config:", error); }
  };
  const handleAutoPingConnection = (connectionId: string, on: boolean) => {
    saveAutoPing({ ...autoPing, connections: { ...autoPing.connections, [connectionId]: on } });
  };

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => asJson(res))
      .then((data) => { const arr = recOf(data)["models"]; if (Array.isArray(arr) && arr.length) setKiloFreeModels(arr as { id: string; isFree?: boolean }[]); })
      .catch(() => {});
  }, [providerId]);

  useEffect(() => {
    Promise.resolve().then(() => { fetchConnections(); fetchAliases(); fetchDisabledModels(); });
  }, [fetchConnections, fetchAliases, fetchDisabledModels]);

  useEffect(() => {
    const providerEntry = (OAUTH_PROVIDERS[providerId] ?? APIKEY_PROVIDERS[providerId] ?? FREE_PROVIDERS[providerId] ?? FREE_TIER_PROVIDERS[providerId]) as { modelsFetcher?: ModelsFetcher } | undefined;
    const fetcher = providerEntry?.modelsFetcher;
    if (!fetcher) return;
    (fetchSuggestedModels as (f: ModelsFetcher) => Promise<SuggestedModel[]>)(fetcher).then(setSuggestedModels);
  }, [providerId]);

  useEffect(() => {
    Promise.resolve().then(() => setSelectedConnectionIds((prev) => prev.filter((id) => connections.some((conn) => conn.id === id))));
  }, [connections]);

  // ---------------------------------------------------------------------------
  // Handlers — aliases
  // ---------------------------------------------------------------------------
  const handleSetAlias = async (modelId: string, alias: string, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: fullModel, alias }) });
      if (res.ok) { await fetchAliases(); } else { const data = await asJson(res); alert(strOf(recOf(data)["error"]) || "Failed to set alias"); }
    } catch (error) { console.log("Error setting alias:", error); }
  };

  const handleDeleteAlias = async (alias: string) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      if (res.ok) await fetchAliases();
    } catch (error) { console.log("Error deleting alias:", error); }
  };

  // ---------------------------------------------------------------------------
  // Handlers — Qoder import
  // ---------------------------------------------------------------------------
  const handleImportQoderModels = async () => {
    if (importingQoderModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) { alert(translate("Please add an active Qoder connection first")); return; }
    setImportingQoderModels(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await asJson(res);
      if (!res.ok) { alert(strOf(recOf(data)["error"]) || translate("Failed to fetch models")); return; }
      const fetchedModels = (recOf(data)["models"] as { id?: string; name?: string }[] | undefined) ?? [];
      if (fetchedModels.length === 0) { alert(translate("No models returned")); return; }
      let importedCount = 0;
      for (const model of fetchedModels) {
        const modelId = model.id ?? model.name;
        if (!modelId) continue;
        const cleanModelId = modelId.replace(/^qoder\//, "");
        const fullModel = `${providerStorageAlias}/${cleanModelId}`;
        if (Object.values(modelAliases).includes(fullModel)) continue;
        const alias = cleanModelId;
        if (modelAliases[alias]) continue;
        await handleSetAlias(cleanModelId, alias, providerStorageAlias);
        importedCount += 1;
      }
      if (importedCount === 0) { alert(translate("All models already exist, no new models added")); }
      else { alert(translate("Successfully added") + ` ${importedCount} ` + translate("models")); }
    } catch (error) { console.log("Error importing Qoder models:", error); alert(translate("Error fetching models") + ": " + (error as Error).message); }
    finally { setImportingQoderModels(false); }
  };

  // ---------------------------------------------------------------------------
  // Handlers — one-by-one test
  // ---------------------------------------------------------------------------
  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;
    const queuedState = Object.fromEntries(connections.map((c) => [c.id, { state: "queued" as const, error: null }]));
    stopOneByOneRef.current = false;
    setOneByOneRunning(true); setOneByOneStopping(false); setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });
    let passed = 0; let failed = 0;
    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({ total: connections.length, completed: index, passed, failed, stopped: true }); break;
        }
        const connection = connections[index]!;
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({ ...prev, [connection.id]: { state: "testing", error: null } }));
        try {
          const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
          const data = await asJson(res);
          const valid = boolOf(recOf(data)["valid"]) === true;
          if (valid) passed += 1; else failed += 1;
          setOneByOneResults((prev) => ({ ...prev, [connection.id]: { state: valid ? "success" : "failed", error: valid ? null : (strOf(recOf(data)["error"]) ?? null) } }));
        } catch (error) {
          failed += 1;
          setOneByOneResults((prev) => ({ ...prev, [connection.id]: { state: "failed", error: (error as Error).message || "Test failed" } }));
        }
        setOneByOneSummary({ total: connections.length, completed: index + 1, passed, failed, stopped: false });
        if (index < connections.length - 1) await sleep(ONE_BY_ONE_DELAY_MS);
      }
    } finally { setOneByOneCurrentConnectionId(null); setOneByOneRunning(false); setOneByOneStopping(false); stopOneByOneRef.current = false; }
  };

  const handleStopOneByOneTest = () => { if (!oneByOneRunning) return; stopOneByOneRef.current = true; setOneByOneStopping(true); };

  // ---------------------------------------------------------------------------
  // Handlers — connection CRUD
  // ---------------------------------------------------------------------------
  const handleDelete = async (id: string) => {
    setConfirmState({
      title: "Delete Connection", message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id));
        } catch (error) { console.log("Error deleting connection:", error); }
      },
    });
  };

  const handleOAuthSuccess = () => { fetchConnections(); setShowOAuthModal(false); };
  const handleIFlowCookieSuccess = () => { fetchConnections(); setShowIFlowCookieModal(false); };

  const handleSaveApiKey = async (formData: Record<string, JsonValue>) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerId, ...formData }) });
      let data: JsonValue | null = null;
      try { data = await asJson(res); } catch { data = null; }
      if (res.ok) { await fetchConnections(); setShowAddApiKeyModal(false); return; }
      setAddConnectionError(strOf(recOf(data ?? {})["error"]) ?? "Failed to save connection");
    } catch (error) { console.log("Error saving connection:", error); setAddConnectionError("Failed to save connection"); }
  };

  const handleUpdateConnection = async (formData: Record<string, JsonValue>) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection?.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (res.ok) { await fetchConnections(); setShowEditModal(false); }
    } catch (error) { console.log("Error updating connection:", error); }
  };

  const handleUpdateConnectionStatus = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (res.ok) setConnections((prev) => prev.map((c) => c.id === id ? { ...c, isActive } : c));
    } catch (error) { console.log("Error updating connection status:", error); }
  };

  const handleSwapPriority = async (index1: number, index2: number) => {
    const newConns = [...connections];
    const a = newConns[index1]!, b = newConns[index2]!;
    newConns[index1] = b; newConns[index2] = a;
    setConnections(newConns);
    try {
      await Promise.all([
        fetch(`/api/providers/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: index1 }) }),
        fetch(`/api/providers/${b.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: index2 }) }),
      ]);
    } catch (error) { console.log("Error swapping priority:", error); await fetchConnections(); }
  };

  // ---------------------------------------------------------------------------
  // Selection + bulk proxy
  // ---------------------------------------------------------------------------
  const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;

  const toggleSelectConnection = (connectionId: string) => {
    setSelectedConnectionIds((prev) => prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]);
  };
  const toggleSelectAllConnections = () => {
    if (allSelected) { setSelectedConnectionIds([]); return; }
    setSelectedConnectionIds(connections.map((conn) => conn.id));
  };
  const clearSelection = () => { setSelectedConnectionIds([]); setBulkProxyPoolId("__none__"); };
  void toggleSelectConnection; void toggleSelectAllConnections; void clearSelection; void allSelected;

  const selectedProxySummary = (() => {
    if (selectedConnections.length === 0) return "";
    const poolIds = new Set(selectedConnections.map((conn) => (conn["providerSpecificData"] as { proxyPoolId?: string } | undefined)?.proxyPoolId ?? "__none__"));
    if (poolIds.size === 1) {
      const onlyId = [...poolIds][0];
      if (onlyId === "__none__") return "All selected currently unbound";
      const pool = proxyPools.find((p) => p.id === onlyId);
      return `All selected currently bound to ${(pool as { name?: string } | undefined)?.name ?? onlyId}`;
    }
    return "Selected connections have mixed proxy bindings";
  })();
  void selectedProxySummary;

  const openBulkProxyModal = () => {
    if (selectedConnections.length === 0) return;
    const uniquePoolIds = [...new Set(selectedConnections.map((conn) => (conn["providerSpecificData"] as { proxyPoolId?: string } | undefined)?.proxyPoolId ?? "__none__"))];
    setBulkProxyPoolId(uniquePoolIds.length === 1 ? (uniquePoolIds[0] ?? "__none__") : "__none__");
    setShowBulkProxyModal(true);
  };
  void openBulkProxyModal; void bulkProxyPoolId;

  const closeBulkProxyModal = () => { if (bulkUpdatingProxy) return; setShowBulkProxyModal(false); };

  const applyProxyAssignments = async (assignments: { connectionId: string; proxyPoolId: string | null }[]) => {
    setBulkUpdatingProxy(true);
    try {
      let failed = 0;
      for (const { connectionId, proxyPoolId } of assignments) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proxyPoolId }) });
          if (!res.ok) failed += 1;
        } catch (e) { console.log("Error applying proxy for", connectionId, e); failed += 1; }
      }
      if (failed > 0) alert(`Updated with ${failed} failed request(s).`);
      await fetchConnections(); setShowBulkProxyModal(false);
    } finally { setBulkUpdatingProxy(false); }
  };

  const handleApplySinglePool = (proxyPoolId: string | null) => {
    const targets = connections.map((c) => ({ connectionId: c.id, proxyPoolId }));
    return applyProxyAssignments(targets);
  };
  const handleApplyOneToOne = () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) { alert("No active proxy pools available."); return; }
    const targets = connections.map((c, i) => ({ connectionId: c.id, proxyPoolId: activePools[i % activePools.length]!.id }));
    return applyProxyAssignments(targets);
  };

  const isSelected = (connectionId: string) => selectedConnectionIds.includes(connectionId);
  void isSelected;

  // ---------------------------------------------------------------------------
  // Handlers — model test
  // ---------------------------------------------------------------------------
  const handleTestModel = async (modelId: string) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const res = await fetch("/api/models/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }) });
      const data = await asJson(res);
      const ok = boolOf(recOf(data)["ok"]) === true;
      setModelTestResults((prev) => ({ ...prev, [modelId]: ok ? "ok" : "error" }));
      setModelsTestError(ok ? "" : (strOf(recOf(data)["error"]) ?? "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
    } finally {
      setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; });
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && (providerInfo as { apiType?: string } | undefined)?.apiType) {
      return (providerInfo as { apiType?: string }).apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return `/providers/${(providerInfo as { id?: string } | undefined)?.id ?? providerId}.png`;
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
        />
      );
    }
    const allModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => { const k = getModelKind(m) as string | undefined; return !k || k === "llm"; });
    const disabledSet = new Set(disabledModelIds);
    const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
    const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
    const customModels = Object.entries(modelAliases)
      .filter(([alias, fullModel]) => {
        if (!fullModel || typeof fullModel !== "string") return false;
        const prefix = `${providerStorageAlias}/`;
        if (!fullModel.startsWith(prefix)) return false;
        const modelId = fullModel.slice(prefix.length);
        if ((providerInfo as { passthroughModels?: boolean } | undefined)?.passthroughModels) return !models.some((m) => m.id === modelId);
        return !models.some((m) => m.id === modelId) && alias === modelId;
      })
      .map(([alias, fullModel]) => ({
        id: fullModel.slice(`${providerStorageAlias}/`.length),
        alias,
        fullModel,
      }));
    return (
      <div className="flex flex-wrap gap-3">
        {customModels.map((model) => (
          <ModelRow
            key={model.id}
            model={{ id: model.id }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied}
            onCopy={copy}
            onDeleteAlias={() => handleDeleteAlias(model.alias)}
            testStatus={modelTestResults[model.id]}
            onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
            isTesting={testingModelIds.has(model.id)}
            isCustom
            isFree={false}
            onDisable={undefined}
            caps={getCaps(`${providerId}/${model.id}`)}
          />
        ))}
        {displayModels.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel || m === oldFormatModel)?.[0];
          return (
            <ModelRow
              key={model.id}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onDeleteAlias={() => handleDeleteAlias(existingAlias ?? "")}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelIds.has(model.id)}
              isCustom={false}
              isFree={model.isFree}
              onDisable={() => handleDisableModel(model.id)}
              caps={getCaps(`${providerId}/${model.id}`)}
            />
          );
        })}
        <button
          onClick={() => setShowAddCustomModel(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs text-primary transition-colors hover:border-primary hover:bg-primary/5 sm:w-auto"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Model
        </button>
        {providerId === "qoder" && connections.some((conn) => conn.isActive !== false) && (
          <button
            onClick={handleImportQoderModels}
            disabled={importingQoderModels}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-500/40 px-3 py-2 text-xs text-blue-600 dark:text-blue-400 transition-colors hover:border-blue-500 hover:bg-blue-500/5 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm" style={importingQoderModels ? { animation: "spin 1s linear infinite" } : undefined}>
              {importingQoderModels ? "progress_activity" : "download"}
            </span>
            {importingQoderModels ? translate("Fetching...") : translate("Fetch Qoder Models")}
          </button>
        )}
        {suggestedModels.length > 0 && (() => {
          const addedFullModels = new Set(Object.values(modelAliases));
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = suggestedModels.filter((m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id));
          if (notAdded.length === 0) return null;
          return (
            <div className="w-full mt-2">
              <p className="text-xs text-text-muted mb-2">Suggested free models (≥200k context):</p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => { const alias = m.id.split("/").pop() ?? m.id; await handleSetAlias(m.id, alias, providerStorageAlias); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs text-text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                    {m.id.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
        {disabledDisplayModels.length > 0 && (
          <div className="w-full mt-2">
            <p className="text-xs text-text-muted mb-2">Disabled models ({disabledDisplayModels.length}):</p>
            <div className="flex flex-wrap gap-2">
              {disabledDisplayModels.map((m) => (
                <button key={m.id} onClick={() => handleEnableModel(m.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-black/10 dark:border-white/10 text-xs text-text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  title="Restore model">
                  <span className="material-symbols-outlined text-[13px]">add</span>
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const activePools = proxyPools.filter((p) => p.isActive === true);

  const connectionsList = (
    <div className="flex min-w-0 flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
      {connections.map((conn, index) => (
        <div key={conn.id} className="flex min-w-0 items-stretch">
          <div className="flex-1 min-w-0">
            <ConnectionRowTyped
              connection={conn}
              proxyPools={proxyPools}
              isOAuth={isOAuth}
              isFirst={index === 0}
              isLast={index === connections.length - 1}
              onMoveUp={() => handleSwapPriority(index, index - 1)}
              onMoveDown={() => handleSwapPriority(index, index + 1)}
              onToggleActive={(isActive: boolean) => handleUpdateConnectionStatus(conn.id, isActive)}
              autoPing={providerId === "claude" && conn.authType === "oauth" ? {
                on: autoPing.connections[conn.id] === true,
                onToggle: (on: boolean) => handleAutoPingConnection(conn.id, on),
              } : null}
              onUpdateProxy={async (proxyPoolId: string) => {
                try {
                  const res = await fetch(`/api/providers/${conn.id}`, {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                  });
                  if (res.ok) {
                    setConnections((prev) => prev.map((c) =>
                      c.id === conn.id
                        ? { ...c, providerSpecificData: { ...(c["providerSpecificData"] as Record<string, JsonValue> | undefined), proxyPoolId: proxyPoolId || null } }
                        : c
                    ));
                  }
                } catch (error) { console.log("Error updating proxy:", error); }
              }}
              onEdit={() => { setSelectedConnection(conn); setShowEditModal(true); }}
              onDelete={() => handleDelete(conn.id)}
              oneByOneStatus={oneByOneResults[conn.id] ?? null}
            />
          </div>
        </div>
      ))}
    </div>
  );

  const bulkActionModal = (
    <Modal isOpen={showBulkProxyModal} onClose={closeBulkProxyModal} title={`Apply Proxy (${connections.length} connections)`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <button onClick={handleApplyOneToOne} disabled={bulkUpdatingProxy || activePools.length === 0}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50">
            <span className="material-symbols-outlined text-text-muted text-[18px]">sync_alt</span>
            <span className="text-sm text-text-main">One-to-one (rotate)</span>
          </button>
          <button onClick={() => handleApplySinglePool(null)} disabled={bulkUpdatingProxy}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50">
            <span className="material-symbols-outlined text-text-muted text-[18px]">link_off</span>
            <span className="text-sm text-text-main">None (unbind all)</span>
          </button>
          {proxyPools.map((pool) => (
            <button key={pool.id} onClick={() => handleApplySinglePool(pool.id)} disabled={bulkUpdatingProxy || pool.isActive !== true}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50">
              <span className="material-symbols-outlined text-text-muted text-[18px]">lan</span>
              <span className="truncate text-sm text-text-main">{(pool as { name?: string }).name}</span>
              {pool.isActive !== true && <span className="text-[10px] text-text-muted">(inactive)</span>}
            </button>
          ))}
        </div>
        {bulkUpdatingProxy && <p className="text-xs text-text-muted">Applying...</p>}
        <Button onClick={closeBulkProxyModal} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>Cancel</Button>
      </div>
    </Modal>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">Back to Providers</Link>
      </div>
    );
  }

  const pi = providerInfo as {
    id?: string; name?: string; color?: string; textIcon?: string; deprecated?: boolean; deprecationNotice?: string;
    notice?: { text?: string; apiKeyUrl?: string; signupUrl?: string }; website?: string;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:gap-8 sm:px-0">
      {/* Header */}
      <div className="min-w-0">
        <Link href="/dashboard/providers" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4">
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to Providers
        </Link>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${pi.color ?? "#888"}15` }}>
            {headerImgError ? (
              <span className="text-sm font-bold" style={{ color: pi.color ?? "#888" }}>
                {pi.textIcon ?? (pi.id ?? providerId).slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image src={getHeaderIconPath()} alt={pi.name ?? providerId} width={48} height={48}
                className="max-h-12 max-w-12 rounded-lg object-contain" sizes="48px" onError={() => setHeaderImgError(true)} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{pi.name}</h1>
              {(pi.notice?.apiKeyUrl || pi.notice?.signupUrl || pi.website) && (
                <a href={pi.notice?.apiKeyUrl ?? pi.notice?.signupUrl ?? pi.website} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  {pi.notice?.apiKeyUrl ? "Get API Key" : "Sign up / Learn more"}
                </a>
              )}
            </div>
            <p className="text-text-muted">{connections.length} connection{connections.length === 1 ? "" : "s"}</p>
          </div>
        </div>
      </div>

      {pi.deprecated && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <span className="material-symbols-outlined text-[16px] text-yellow-500 mt-0.5 shrink-0">warning</span>
          <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">{pi.deprecationNotice}</p>
        </div>
      )}

      {pi.notice?.text && !pi.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-[16px] text-blue-500 shrink-0">info</span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">{pi.notice.text}</p>
          {pi.notice.apiKeyUrl && (
            <a href={pi.notice.apiKeyUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5">
              Get API Key →
            </a>
          )}
        </div>
      )}

      {/* Compatible node details */}
      {isCompatible && providerNode && (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
              <p className="break-all text-sm text-text-muted">
                {isAnthropicCompatible ? "Messages API" : ((providerNode["apiType"] as string | undefined) === "responses" ? "Responses API" : "Chat Completions")}
                {" · "}{((providerNode["baseUrl"] as string | undefined) ?? "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : ((providerNode["apiType"] as string | undefined) === "responses" ? "responses" : "chat/completions")}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button size="sm" icon="add" onClick={() => { setAddConnectionError(""); setShowAddApiKeyModal(true); }} className="w-full sm:w-auto">Add API Key</Button>
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setShowEditNodeModal(true)} className="w-full sm:w-auto">Edit</Button>
              <Button size="sm" variant="secondary" icon="delete" className="w-full sm:w-auto"
                onClick={async () => {
                  setConfirmState({
                    title: "Delete Compatible Node",
                    message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
                    onConfirm: async () => {
                      setConfirmState(null);
                      try {
                        const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                        if (res.ok) router.push("/dashboard/providers");
                      } catch (error) { console.log("Error deleting provider node:", error); }
                    },
                  });
                }}>Delete</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Connections */}
      {isFreeNoAuth ? (
        <NoAuthProxyCard providerId={providerId} />
      ) : (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Connections</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              {connections.length > 0 && proxyPools.length > 0 && (
                <Button size="sm" variant="secondary" icon="lan" onClick={() => setShowBulkProxyModal(true)}>Apply Proxy</Button>
              )}
              {connections.length > 0 && (
                <>
                  <Button size="sm" variant="secondary" icon="sync" onClick={handleRunOneByOneTest} disabled={oneByOneRunning}>
                    {oneByOneRunning ? "Testing Connection One-by-One..." : "Test Connection One-by-One"}
                  </Button>
                  {oneByOneRunning && (
                    <Button size="sm" variant="ghost" icon="stop" onClick={handleStopOneByOneTest} disabled={oneByOneStopping}>
                      {oneByOneStopping ? "Stopping..." : "Stop"}
                    </Button>
                  )}
                </>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Round Robin</span>
                <Toggle checked={providerStrategy === "round-robin"} onChange={handleRoundRobinToggle} />
                {providerStrategy === "round-robin" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-muted">Sticky:</span>
                    <input type="number" min={1} value={providerStickyLimit}
                      onChange={(e) => handleStickyLimitChange(e.target.value)} placeholder="1"
                      className="w-14 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {connections.length === 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0">
                  <span className="material-symbols-outlined text-[18px]">{isOAuth ? "lock" : "key"}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-text-muted">No connections yet</p>
                  {hasDualAuthModes && <p className="text-xs text-text-muted">Choose {oauthConnectionLabel} or {apiKeyConnectionLabel}.</p>}
                </div>
              </div>
              <div className="flex gap-2">
                {hasDualAuthModes ? (
                  <>
                    <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection}>{oauthConnectionLabel}</Button>
                    <Button size="sm" icon="key" onClick={triggerApiKeyConnection}>{apiKeyConnectionLabel}</Button>
                  </>
                ) : (
                  <>
                    {!isCompatible && providerId === "iflow" && (
                      <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)}>Cookie</Button>
                    )}
                    {providerId === "codex" && (
                      <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)}>{translate("Bulk Add")}</Button>
                    )}
                    <Button size="sm" icon="add" onClick={triggerAddConnection}>
                      {isCompatible ? "Add API Key" : (providerId === "iflow" ? "OAuth" : "Add Connection")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {oneByOneSummary && (
                <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Total: {oneByOneSummary.total}</span>
                    <span>Completed: {oneByOneSummary.completed}</span>
                    <span>Passed: {oneByOneSummary.passed}</span>
                    <span>Failed: {oneByOneSummary.failed}</span>
                    {oneByOneSummary.stopped && <span className="text-amber-600 dark:text-amber-400">Stopped</span>}
                    {oneByOneRunning && oneByOneCurrentConnectionId && (
                      <span>Running: {connections.find((conn) => conn.id === oneByOneCurrentConnectionId)?.name ?? oneByOneCurrentConnectionId}</span>
                    )}
                  </div>
                </div>
              )}
              {connectionsList}
              {!isCompatible && (
                <div className="mt-4 grid grid-cols-1 gap-2 sm:flex">
                  {providerId === "iflow" && (
                    <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)} title="Add connection using browser cookie" className="w-full sm:w-auto">Cookie</Button>
                  )}
                  {providerId === "codex" && (
                    <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)} title={translate("Bulk import codex accounts from JSON")} className="w-full sm:w-auto">{translate("Bulk Add")}</Button>
                  )}
                  {hasDualAuthModes ? (
                    <>
                      <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection} className="w-full sm:w-auto">{oauthConnectionLabel}</Button>
                      <Button size="sm" icon="key" onClick={triggerApiKeyConnection} className="w-full sm:w-auto">{apiKeyConnectionLabel}</Button>
                    </>
                  ) : (
                    <Button size="sm" icon="add" onClick={triggerAddConnection} className="w-full sm:w-auto">Add</Button>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Models */}
      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">{"Available Models"}</h2>
          {!isCompatible && (() => {
            const allIds = [
              ...models,
              ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
            ].filter((m) => { const k = getModelKind(m) as string | undefined; return !k || k === "llm"; }).map((m) => m.id);
            const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));
            return (
              <div className="flex gap-2">
                {disabledModelIds.length > 0 && (
                  <Button size="sm" variant="secondary" icon="restart_alt" onClick={handleEnableAll}>Active All</Button>
                )}
                {activeIds.length > 0 && (
                  <Button size="sm" variant="secondary" icon="block" onClick={() => handleDisableAll(activeIds)}>Disable All</Button>
                )}
              </div>
            );
          })()}
        </div>
        {!!modelsTestError && <p className="text-xs text-red-500 mb-3 break-words">{modelsTestError}</p>}
        {renderModelsSection()}
      </Card>

      {bulkActionModal}

      {/* OAuth modals */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper isOpen={showOAuthModal} providerInfo={providerInfo} onSuccess={handleOAuthSuccess} onClose={() => setShowOAuthModal(false)} />
      ) : providerId === "cursor" ? (
        <CursorAuthModal isOpen={showOAuthModal} onSuccess={handleOAuthSuccess} onClose={() => setShowOAuthModal(false)} />
      ) : providerId === "gitlab" ? (
        <GitLabAuthModal isOpen={showOAuthModal} providerInfo={providerInfo} onSuccess={handleOAuthSuccess} onClose={() => setShowOAuthModal(false)} />
      ) : (
        <OAuthModalTyped isOpen={showOAuthModal} provider={providerId} providerInfo={providerInfo as JsonValue} onSuccess={handleOAuthSuccess} onClose={() => setShowOAuthModal(false)} oauthMeta={null} idcConfig={null} />
      )}
      {providerId === "iflow" && (
        <IFlowCookieModal isOpen={showIFlowCookieModal} onSuccess={handleIFlowCookieSuccess} onClose={() => setShowIFlowCookieModal(false)} />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal} provider={providerId} providerName={(providerInfo as { name?: string }).name ?? providerId}
        isCompatible={isCompatible} isAnthropic={isAnthropicCompatible}
        authType={(providerInfo as { authType?: string }).authType}
        authHint={(providerInfo as { authHint?: string }).authHint}
        website={(providerInfo as { website?: string }).website}
        proxyPools={proxyPools} error={addConnectionError}
        onSave={handleSaveApiKey} onBulkDone={fetchConnections}
        onClose={() => { setAddConnectionError(""); setShowAddApiKeyModal(false); }}
      />
      <EditConnectionModal
        isOpen={showEditModal} connection={selectedConnection} proxyPools={proxyPools}
        onSave={handleUpdateConnection} onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          key={`${(providerNode?.["id"] as string | undefined) ?? "none"}-${showEditNodeModal ? "open" : "closed"}`}
          isOpen={showEditNodeModal} node={providerNode} onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)} isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && (
        <AddCustomModelModal
          key={showAddCustomModel ? "open" : "closed"}
          isOpen={showAddCustomModel} providerAlias={providerStorageAlias} providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId: string) => {
            const alias = (providerInfo as { passthroughModels?: boolean }).passthroughModels ? (modelId.split("/").pop() ?? modelId) : modelId;
            await handleSetAlias(modelId, alias, providerStorageAlias);
            setShowAddCustomModel(false);
          }}
          onClose={() => setShowAddCustomModel(false)}
        />
      )}
      {providerId === "codex" && (
        <BulkImportCodexModal isOpen={showBulkImportCodex} onClose={() => setShowBulkImportCodex(false)} onSuccess={fetchConnections} />
      )}
      <ConfirmModal
        isOpen={showAgRiskModal} onClose={() => setShowAgRiskModal(false)} onConfirm={handleAgRiskConfirm}
        title="Risk Notice" message={(providerInfo as { deprecationNotice?: string }).deprecationNotice}
        confirmText="I Understand, Continue" cancelText="Cancel" variant="danger"
      />
      <ConfirmModal
        isOpen={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={confirmState?.onConfirm}
        title={confirmState?.title ?? "Confirm"} message={confirmState?.message} variant="danger"
      />
    </div>
  );
}
