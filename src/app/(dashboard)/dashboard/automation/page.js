"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  BulkAccountAutomationModal,
  Card,
  CardSkeleton,
  OAuthModal,
} from "@/shared/components";
import { FREE_PROVIDERS, OAUTH_PROVIDERS } from "@/shared/constants/providers";

function getConnectionLabel(count) {
  return `${count} connection${count === 1 ? "" : "s"}`;
}

function QoderAutomationPanel({ providerInfo, onRefresh }) {
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isOAuthOpen, setIsOAuthOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setIsBulkOpen(true)}
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">
              group_add
            </span>
            Auto Login Bulk
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Run bulk gmail:password or gmail|password automation via Google SSO
            with Qoder device flow.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIsOAuthOpen(true)}
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">
              login
            </span>
            Device OAuth Login
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Open Qoder device login in browser and poll until the token is
            saved.
          </span>
        </button>
      </div>
      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="qoder"
        title="Qoder Bulk GSuite Auto Login"
        serviceName="Qoder"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
      <OAuthModal
        isOpen={isOAuthOpen}
        provider="qoder"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOAuthOpen(false);
        }}
        onClose={() => setIsOAuthOpen(false)}
      />
    </>
  );
}

function AutoClawAutomationPanel({ providerInfo, onRefresh }) {
  const [isOAuthOpen, setIsOAuthOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/dashboard/automation/autoclaw/bulk"
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">
              group_add
            </span>
            Auto Login Bulk
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Run bulk gmail:password or gmail|password automation via Google
            OAuth with AutoClaw. Workers run one at a time (AutoClaw&apos;s
            Google client locks the redirect port).
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setIsOAuthOpen(true)}
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">
              login
            </span>
            Device OAuth Login
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Open AutoClaw Google login in browser and wait until the token is
            saved.
          </span>
        </button>
      </div>
      <OAuthModal
        isOpen={isOAuthOpen}
        provider="autoclaw"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOAuthOpen(false);
        }}
        onClose={() => setIsOAuthOpen(false)}
      />
    </>
  );
}

function CodeBuddyAutomationPanel({ providerInfo, onRefresh }) {
  const [isOAuthOpen, setIsOAuthOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setIsOAuthOpen(true)}
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">
              login
            </span>
            Device OAuth Login
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Open CodeBuddy CN device login in browser and poll until token is
            saved.
          </span>
        </button>
      </div>
      <OAuthModal
        isOpen={isOAuthOpen}
        provider="codebuddy-cn"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOAuthOpen(false);
        }}
        onClose={() => setIsOAuthOpen(false)}
      />
    </>
  );
}

const AUTOMATION_PROVIDERS = [
  {
    id: "qoder",
    label: "Qoder",
    icon: "code",
    description: "Bulk GSuite auto login via Google SSO and device flow.",
    supportedModes: ["bulk-account", "device-oauth"],
    component: QoderAutomationPanel,
  },
  {
    id: "autoclaw",
    label: "AutoClaw",
    icon: "smart_toy",
    description: "Bulk Google OAuth auto login via AutoClaw and device OAuth.",
    supportedModes: ["bulk-account", "device-oauth"],
    component: AutoClawAutomationPanel,
  },
  {
    id: "codebuddy-cn",
    label: "CodeBuddy CN",
    icon: "smart_toy",
    description: "Bulk phone SMS login via 5sim OTP and device flow.",
    supportedModes: ["bulk-sms-5sim", "device-oauth"],
    component: CodeBuddyAutomationPanel,
  },
];

export default function AutomationPage() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProviderId, setActiveProviderId] = useState(
    AUTOMATION_PROVIDERS[0].id,
  );

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setConnections(data.connections || []);
    } catch (error) {
      console.log("Error fetching automation connections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestedProvider = new URLSearchParams(window.location.search).get(
      "provider",
    );
    if (
      AUTOMATION_PROVIDERS.some((provider) => provider.id === requestedProvider)
    ) {
      setActiveProviderId(requestedProvider);
    }
  }, []);

  const activeProvider =
    AUTOMATION_PROVIDERS.find((provider) => provider.id === activeProviderId) ||
    AUTOMATION_PROVIDERS[0];
  const providerInfo = FREE_PROVIDERS[activeProvider.id] ||
    OAUTH_PROVIDERS[activeProvider.id] || {
      id: activeProvider.id,
      name: activeProvider.label,
    };
  const ProviderPanel = activeProvider.component;
  const providerCounts = useMemo(() => {
    const counts = {};
    for (const provider of AUTOMATION_PROVIDERS) {
      counts[provider.id] = connections.filter(
        (connection) => connection.provider === provider.id,
      ).length;
    }
    return counts;
  }, [connections]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Automation</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {AUTOMATION_PROVIDERS.map((provider) => {
          const selected = provider.id === activeProviderId;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => setActiveProviderId(provider.id)}
              className={`flex min-w-0 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-surface text-text-main hover:border-primary/30 hover:bg-primary/5"
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">
                {provider.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {provider.label}
                </span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {getConnectionLabel(providerCounts[provider.id] || 0)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[22px] text-primary">
                  {activeProvider.icon}
                </span>
                <h2 className="text-lg font-semibold">
                  {activeProvider.label}
                </h2>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeProvider.supportedModes.map((mode) => (
                  <Badge key={mode} variant="default" size="sm">
                    {mode}
                  </Badge>
                ))}
              </div>
            </div>
            <Badge variant="success">
              {getConnectionLabel(providerCounts[activeProvider.id] || 0)}
            </Badge>
          </div>

          <ProviderPanel
            providerInfo={providerInfo}
            onRefresh={fetchConnections}
          />
        </div>
      </Card>
    </div>
  );
}
