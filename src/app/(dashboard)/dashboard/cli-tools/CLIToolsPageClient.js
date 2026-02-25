"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardSkeleton } from "@/shared/components";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { PROVIDER_MODELS, getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { ClaudeToolCard, CodexToolCard, DroidToolCard, OpenClawToolCard, DefaultToolCard, AntigravityToolCard } from "./components";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

const STATUS_ENDPOINTS = {
  claude: "/api/cli-tools/claude-settings",
  codex: "/api/cli-tools/codex-settings",
  droid: "/api/cli-tools/droid-settings",
  openclaw: "/api/cli-tools/openclaw-settings",
  antigravity: "/api/cli-tools/antigravity-mitm",
};

export default function CLIToolsPageClient({ machineId }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTool, setExpandedTool] = useState(null);
  const [modelMappings, setModelMappings] = useState({});
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [apiKeys, setApiKeys] = useState([]);
  const [toolStatuses, setToolStatuses] = useState({});

  useEffect(() => {
    fetchConnections();
    loadCloudSettings();
    fetchApiKeys();
    fetchAllStatuses();
  }, []);

  const fetchAllStatuses = async () => {
    try {
      const entries = await Promise.all(
        Object.entries(STATUS_ENDPOINTS).map(async ([toolId, url]) => {
          try {
            const res = await fetch(url);
            const data = await res.json();
            return [toolId, data];
          } catch {
            return [toolId, null];
          }
        })
      );
      setToolStatuses(Object.fromEntries(entries));
    } catch (error) {
      console.log("Error fetching tool statuses:", error);
    }
  };

  const loadCloudSettings = async () => {
    try {
      const [settingsRes, tunnelRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status"),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setCloudEnabled(data.cloudEnabled || false);
      }
      if (tunnelRes.ok) {
        const data = await tunnelRes.json();
        setTunnelEnabled(data.enabled || false);
        setTunnelUrl(data.tunnelUrl || "");
      }
    } catch (error) {
      console.log("Error loading settings:", error);
    }
  };

  const fetchApiKeys = async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch (error) {
      console.log("Error fetching API keys:", error);
    }
  };

  const fetchConnections = async () => {
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      if (res.ok) {
        setConnections(data.connections || []);
      }
    } catch (error) {
      console.log("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  };

  const getActiveProviders = () => {
    return connections.filter(c => c.isActive !== false);
  };

  const getAllAvailableModels = () => {
    const activeProviders = getActiveProviders();
    const models = [];
    const seenModels = new Set();
    
    activeProviders.forEach(conn => {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      const providerModels = getModelsByProviderId(conn.provider);
      providerModels.forEach(m => {
        const modelValue = `${alias}/${m.id}`;
        if (!seenModels.has(modelValue)) {
          seenModels.add(modelValue);
          models.push({
            value: modelValue,
            label: `${alias}/${m.id}`,
            provider: conn.provider,
            alias: alias,
            connectionName: conn.name,
            modelId: m.id,
          });
        }
      });
    });
    
    return models;
  };

  const handleModelMappingChange = useCallback((toolId, modelAlias, targetModel) => {
    setModelMappings(prev => {
      // Prevent unnecessary updates if value hasn't changed
      if (prev[toolId]?.[modelAlias] === targetModel) {
        return prev;
      }
      return {
        ...prev,
        [toolId]: {
          ...prev[toolId],
          [modelAlias]: targetModel,
        },
      };
    });
  }, []);

  const getBaseUrl = () => {
    if (tunnelEnabled && tunnelUrl) {
      return tunnelUrl;
    }
    if (cloudEnabled && CLOUD_URL) {
      return CLOUD_URL;
    }
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return "http://localhost:20128";
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  const availableModels = getAllAvailableModels();
  const hasActiveProviders = availableModels.length > 0;

  const renderToolCard = (toolId, tool) => {
    const commonProps = {
      tool,
      isExpanded: expandedTool === toolId,
      onToggle: () => setExpandedTool(expandedTool === toolId ? null : toolId),
      baseUrl: getBaseUrl(),
      apiKeys,
    };

    switch (toolId) {
      case "claude":
        return (
          <ClaudeToolCard
            key={toolId}
            {...commonProps}
            activeProviders={getActiveProviders()}
            modelMappings={modelMappings[toolId] || {}}
            onModelMappingChange={(alias, target) => handleModelMappingChange(toolId, alias, target)}
            hasActiveProviders={hasActiveProviders}
            cloudEnabled={cloudEnabled}
            initialStatus={toolStatuses.claude}
          />
        );
      case "codex":
        return <CodexToolCard key={toolId} {...commonProps} activeProviders={getActiveProviders()} cloudEnabled={cloudEnabled} initialStatus={toolStatuses.codex} />;
      case "droid":
        return <DroidToolCard key={toolId} {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} initialStatus={toolStatuses.droid} />;
      case "openclaw":
        return <OpenClawToolCard key={toolId} {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} initialStatus={toolStatuses.openclaw} />;
      case "antigravity":
        return <AntigravityToolCard key={toolId} {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} cloudEnabled={cloudEnabled} initialStatus={toolStatuses.antigravity} />;
      default:
        return <DefaultToolCard key={toolId} toolId={toolId} {...commonProps} activeProviders={getActiveProviders()} cloudEnabled={cloudEnabled} />;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {!hasActiveProviders && (
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-yellow-500">warning</span>
            <div>
              <p className="font-medium text-yellow-600 dark:text-yellow-400">No active providers</p>
              <p className="text-sm text-text-muted">Please add and connect providers first to configure CLI tools.</p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {Object.entries(CLI_TOOLS).map(([toolId, tool]) => renderToolCard(toolId, tool))}
      </div>
    </div>
  );
}
