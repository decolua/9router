"use client";

import { useState, useEffect } from "react";
import { MITM_TOOLS } from "@/shared/constants/cliTools";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { MitmServerCard, MitmToolCard } from "@/app/(dashboard)/dashboard/cli-tools/components";
import InlineAlert from "@/shared/components/InlineAlert";

export default function MitmPageClient() {
  const [connections, setConnections] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [expandedTool, setExpandedTool] = useState(null);
  const [mitmStatus, setMitmStatus] = useState({ running: false, certExists: false, dnsStatus: {}, hasCachedPassword: false });

  const fetchConnections = async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
      }
    } catch { /* ignore */ }
  };

  const fetchApiKeys = async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch { /* ignore */ }
  };

  const fetchAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      if (res.ok) {
        const data = await res.json();
        setModelAliases(data.aliases || {});
      }
    } catch { /* ignore */ }
  };

  const fetchCloudSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setCloudEnabled(data.cloudEnabled || false);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConnections();
    fetchApiKeys();
    fetchAliases();
    fetchCloudSettings();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getActiveProviders = () => connections.filter(c => c.isActive !== false);

  const hasActiveProviders = () => {
    const active = getActiveProviders();
    return active.some(conn =>
      getModelsByProviderId(conn.provider).length > 0 ||
      isOpenAICompatibleProvider(conn.provider) ||
      isAnthropicCompatibleProvider(conn.provider)
    );
  };

  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className="flex w-full flex-col gap-6">
      <InlineAlert
        variant="caution"
        message="MITM intercepts HTTPS traffic of IDE tools (Antigravity, GitHub Copilot, Kiro) via a local CA to redirect requests to your providers. May violate provider ToS and lead to account bans. Use at your own risk."
      />

      {/* MITM Server Card */}
      <MitmServerCard
        apiKeys={apiKeys}
        cloudEnabled={cloudEnabled}
        onStatusChange={setMitmStatus}
      />

      {/* Tool Cards */}
      <div className="grid gap-3 sm:gap-4">
        {mitmTools.map(([toolId, tool]) => (
          <MitmToolCard
            key={toolId}
            tool={tool}
            isExpanded={expandedTool === toolId}
            onToggle={() => setExpandedTool(expandedTool === toolId ? null : toolId)}
            serverRunning={mitmStatus.running}
            dnsActive={mitmStatus.dnsStatus?.[toolId] || false}
            hasCachedPassword={mitmStatus.hasCachedPassword || false}
            needsSudoPassword={mitmStatus.needsSudoPassword !== false}
            isWin={mitmStatus.isWin === true}
            apiKeys={apiKeys}
            activeProviders={getActiveProviders()}
            hasActiveProviders={hasActiveProviders()}
            modelAliases={modelAliases}
            cloudEnabled={cloudEnabled}
            onDnsChange={(data) => setMitmStatus(prev => ({ ...prev, dnsStatus: data.dnsStatus ?? prev.dnsStatus }))}
          />
        ))}
      </div>
    </div>
  );
}
