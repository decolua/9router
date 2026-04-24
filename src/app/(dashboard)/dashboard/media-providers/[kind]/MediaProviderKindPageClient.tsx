"use client";

import React, { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, Badge } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";
import { cn } from "@/lib/utils";

interface Connection {
  id: string;
  provider: string;
  isActive: boolean;
  testStatus: string;
  [key: string]: any;
}

interface MediaProvider {
  id: string;
  name: string;
  color?: string;
  textIcon?: string;
}

function getEffectiveStatus(conn: Connection) {
  const isCooldown = Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v as string).getTime() > Date.now()
  );
  return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
}

interface MediaProviderCardProps {
  provider: MediaProvider;
  kind: string;
  connections: Connection[];
}

function MediaProviderCard({ provider, kind, connections }: MediaProviderCardProps) {
  const providerInfo = (AI_PROVIDERS as any)[provider.id];
  const isNoAuth = !!providerInfo?.noAuth;

  const providerConns = connections.filter((c) => c.provider === provider.id);
  const connected = providerConns.filter((c) => { 
    const s = getEffectiveStatus(c); 
    return s === "active" || s === "success"; 
  }).length;
  const error = providerConns.filter((c) => { 
    const s = getEffectiveStatus(c); 
    return s === "error" || s === "expired" || s === "unavailable"; 
  }).length;
  const total = providerConns.length;
  const allDisabled = total > 0 && providerConns.every((c) => c.isActive === false);

  const renderStatus = () => {
    if (isNoAuth) return <Badge className="bg-primary/10 text-primary border-none h-5 text-[10px] font-bold uppercase rounded-none">READY</Badge>;
    if (allDisabled) return <Badge variant="secondary" className="border-none h-5 text-[10px] font-bold uppercase rounded-none opacity-40">DISABLED</Badge>;
    if (total === 0) return <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">No connections</span>;
    return (
      <>
        {connected > 0 && <Badge className="bg-primary/10 text-primary border-none h-5 text-[10px] font-bold uppercase rounded-none">{connected} Connected</Badge>}
        {error > 0 && <Badge variant="destructive" className="border-none h-5 text-[10px] font-bold uppercase rounded-none">{error} Error</Badge>}
        {connected === 0 && error === 0 && <Badge variant="outline" className="border-border/50 text-muted-foreground h-5 text-[10px] font-bold uppercase rounded-none">{total} Added</Badge>}
      </>
    );
  };

  return (
    <Link href={`/dashboard/media-providers/${kind}/${provider.id}`} className="group">
      <Card
        className={cn(
          "h-full hover:bg-muted/10 transition-all border-border/50 shadow-none rounded-none p-4",
          allDisabled && "opacity-50 grayscale"
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className="size-10 rounded-none border border-border/50 bg-background flex items-center justify-center shrink-0 shadow-none"
            style={{ backgroundColor: `${provider.color?.length && provider.color.length > 7 ? provider.color : (provider.color ?? "#888") + "08"}` }}
          >
            <ProviderIcon
              src={`/providers/${provider.id}.png`}
              alt={provider.name}
              size={24}
              className={cn(
                "object-contain",
                (provider.id === "codex" || provider.id === "openai" || provider.id === "github") && "dark:invert"
              )}
              fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
              fallbackColor={provider.color}
            />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm tracking-tight text-foreground truncate uppercase">{provider.name}</h3>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {renderStatus()}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function MediaProviderKindPage({ kind }: { kind: string }) {
  const [connections, setConnections] = useState<Connection[]>([]);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  if (!kindConfig) return notFound();

  const providers = getProvidersByKind(kind);

  useEffect(() => {
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setConnections(d.connections || []))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-6 py-6 px-4">
      {/* Page Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs uppercase tracking-tight">
            <div className="size-2 rounded-full bg-primary/40 animate-pulse" />
            Infrastructure Capability
          </div>
          <h1 className="text-3xl font-medium tracking-tight text-foreground uppercase">{kindConfig.label}</h1>
          <p className="text-sm text-muted-foreground font-medium italic opacity-70">
            Configure {kindConfig.label} infrastructure routing and egress nodes.
          </p>
        </div>
      </header>

      {providers.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border/30 rounded-none bg-muted/5 opacity-40 grayscale flex flex-col items-center justify-center gap-3">
          <ProviderIcon size={48} className="opacity-20" />
          <p className="text-xs font-bold uppercase tracking-[0.3em]">No providers provisioned for {kindConfig.label}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {providers.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider as any}
              kind={kind}
              connections={connections}
            />
          ))}
        </div>
      )}
    </div>
  );
}
