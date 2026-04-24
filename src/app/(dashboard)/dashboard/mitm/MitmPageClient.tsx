"use client";

import React, { useState, useEffect } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { translate } from "@/i18n/runtime";
import { MITM_TOOLS } from "@/shared/constants/cliTools";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { MitmServerCard, MitmToolCard } from "@/app/(dashboard)/dashboard/cli-tools/components";

interface Connection {
  id: string;
  provider: string;
  isActive: boolean;
  [key: string]: any;
}

interface ApiKey {
  id: string;
  key: string;
  isActive: boolean;
  [key: string]: any;
}

interface MitmStatus {
  running: boolean;
  certExists: boolean;
  dnsStatus: Record<string, boolean>;
  hasCachedPassword: boolean;
  pid?: number | null;
  certTrusted?: boolean;
  isAdmin?: boolean;
}

export default function MitmPageClient() {
 const [connections, setConnections] = useState<Connection[]>([]);
 const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
 const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
 const [cloudEnabled, setCloudEnabled] = useState(false);
 const [expandedTool, setExpandedTool] = useState<string | null>(null);
 const [mitmStatus, setMitmStatus] = useState<MitmStatus>({ running: false, certExists: false, dnsStatus: {}, hasCachedPassword: false });

 useEffect(() => {
 fetchConnections();
 fetchApiKeys();
 fetchAliases();
 fetchCloudSettings();
 }, []);

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
 <div className="mx-auto max-w-7xl flex flex-col gap-6 py-6 px-4">
 {/* Page Header */}
 <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/50">
 <div className="space-y-1">
 <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs uppercase tracking-tight">
 <ShieldCheck className="size-4" weight="bold"/>
 Development Tools
 </div>
 <h1 className="text-3xl font-medium tracking-tight">MITM Proxy</h1>
 <p className="text-sm text-muted-foreground font-medium">
 {translate("Intercept CLI tool traffic and route through 8Router.")}
 </p>
 </div>
 </header>

 {/* MITM Server Card */}
 <MitmServerCard
 apiKeys={apiKeys}
 cloudEnabled={cloudEnabled}
 onStatusChange={(status: any) => setMitmStatus(status)}
 />

 {/* Tool Cards */}
 <div className="flex flex-col gap-2">
 {mitmTools.map(([toolId, tool]) => (
 <MitmToolCard
 key={toolId}
 tool={tool as any}
 isExpanded={expandedTool === toolId}
 onToggle={() => setExpandedTool(expandedTool === toolId ? null : toolId)}
 serverRunning={mitmStatus.running}
 dnsActive={mitmStatus.dnsStatus?.[toolId] || false}
 hasCachedPassword={mitmStatus.hasCachedPassword || false}
 apiKeys={apiKeys}
 activeProviders={getActiveProviders()}
 hasActiveProviders={hasActiveProviders()}
 modelAliases={modelAliases}
 cloudEnabled={cloudEnabled}
 onDnsChange={(data: any) => setMitmStatus(prev => ({ ...prev, dnsStatus: data.dnsStatus ?? prev.dnsStatus }))}
 />
 ))}
 </div>
 </div>
 );
}
