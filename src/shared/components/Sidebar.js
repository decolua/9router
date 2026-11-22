"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import useSettingsStore from "@/store/settingsStore";
import { useSessionStore } from "@/store/sessionStore";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music", "systemone"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Search & Fetch", icon: "explore", href: "/dashboard/media-providers/web" };
const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Keys", icon: "network_node" },
  { href: "/dashboard/providers", label: "Provider Connections", icon: "hub" },
  { href: "/dashboard/combos", label: "Model Routes", icon: "merge_type" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/usage", label: "Usage & Analytics", icon: "query_stats" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "speed" },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "code_blocks" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "compress" },
];

// Custom features added by this fork - open-ended, new tools land here too.
const workshopItems = [
  { href: "/dashboard/model-editor", label: "Model Studio", icon: "edit_square" },
  { href: "/dashboard/arena", label: "Model Lab", icon: "compare" },
  { href: "/dashboard/auto-harvester", label: "Provider Discovery", icon: "network_check" },
  { href: "/dashboard/cli-tools", label: "CLI Integrations", icon: "code_blocks" },
  { href: "/dashboard/token-saver", label: "Request Optimizer", icon: "compress" },
];

// Security Log and Inbox Error live in the bell, not the menu - they are
// conditions to review, not places you visit to work.
const debugItems = [
  { href: "/dashboard/logs", label: "Activity Logs", icon: "receipt" },
  { href: "/dashboard/translator", label: "Translator", icon: "swap_horiz" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Network Pools", icon: "router" },
];

// Nothing is granted until /api/auth/status says so. The menu used to fall back
// to a full-admin object while `permissions` was still null, which meant an API
// key with only dashboard access saw every admin item for as long as the fetch
// took -- seconds on a phone. Deny-by-default removes the flash: the menu is
// empty until the real permissions arrive.
const NO_PERMISSIONS = {
  manageApiKeys: false,
  manageModels: false,
  manageProviders: false,
  manageTools: false,
  manageAdvanced: false,
  managePlugins: false,
  manageMediaProviders: false,
  viewUsage: false,
};

function NavLink({ href, icon, label, active, onClick, sub = false }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-11 min-w-0 items-center gap-3 rounded-[9px] px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        sub && "ml-2 min-h-10 pl-3",
        active
          ? "bg-primary/10 text-primary font-semibold"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
      )}
      <span
        className={cn(
          "material-symbols-outlined size-[18px] shrink-0 text-[18px] leading-none",
          active ? "fill-1 text-primary" : "group-hover:text-primary transition-colors"
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="text-[13px] font-medium leading-none min-w-0 truncate" title={label}>{label}</span>
    </Link>
  );
}

function NavSection({ title, items, isActive, onClose, badge }) {
  if (!items.length) return null;

  return (
    <section aria-label={title} className="border-t border-border-subtle pt-3 first:border-0 first:pt-0">
      <h2 className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {title}
        {badge && (
          <span className="ml-2 rounded-[3px] bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-green-400">
            {badge}
          </span>
        )}
      </h2>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={isActive(item.href)}
            onClick={onClose}
          />
        ))}
      </div>
    </section>
  );
}

export default function Sidebar({ onClose, side = "right" }) {
  const pathname = usePathname();
  const [enableTranslator, setEnableTranslator] = useState(false);
  // One cached session for the whole shell; the theme store and HeaderMenu read
  // the same role instead of each fetching /api/auth/status again.
  // Two scalar selectors: an object-returning selector would hand React a new
  // identity on every store change and re-render the sidebar in a loop.
  const sessionRole = useSessionStore((state) => state.role);
  const sessionPermissions = useSessionStore((state) => state.permissions);
  const sessionLoaded = useSessionStore((state) => state.loaded);
  const setSession = useSessionStore((state) => state.setSession);
  const authStatus = { role: sessionRole, permissions: sessionPermissions };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSession(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setSession]);

  const isApiKeyUser = authStatus.role === "apikey";
  const permissions = authStatus.permissions || NO_PERMISSIONS;

  // A session that has not resolved yet is not an admin session: it is an
  // unknown one. Until `loaded` flips, every menu group stays empty so a
  // restricted key never renders admin links it cannot open.
  const sessionReady = sessionLoaded === true;

  const filteredNavItems = navItems.filter((item) => {
    if (!sessionReady) return false;
    if (!isApiKeyUser) return true;
    if (item.href === "/dashboard/endpoint") return permissions.manageApiKeys;
    if (item.href === "/dashboard/providers") return permissions.manageProviders;
    if (item.href === "/dashboard/combos") return permissions.manageModels;
    if (item.href === "/dashboard/usage") return permissions.viewUsage;
    if (item.href === "/dashboard/api-key-usage") return permissions.viewUsage || permissions.manageApiKeys;
    if (item.href === "/dashboard/quota") return permissions.manageProviders;
    if (item.href === "/dashboard/token-saver" || item.href === "/dashboard/cli-tools") return permissions.manageTools;
    return false;
  });

  const filteredWorkshopItems = workshopItems.filter((item) => {
    if (!sessionReady) return false;
    if (!isApiKeyUser) return true;
    if (item.href === "/dashboard/cli-tools" || item.href === "/dashboard/token-saver") return permissions.manageTools;
    if (item.href === "/dashboard/model-editor" || item.href === "/dashboard/arena") {
      return permissions.manageModels;
    }
    if (item.href === "/dashboard/auto-harvester") {
      return permissions.manageAdvanced;
    }
    return false;
  });

  const filteredDebugItems = debugItems.filter((item) => {
    if (!sessionReady) return false;
    if (!isApiKeyUser) return true;
    return permissions.manageAdvanced;
  });

  const filteredSystemItems = systemItems.filter((item) => {
    if (!sessionReady) return false;
    if (!isApiKeyUser) return true;
    return permissions.manageAdvanced;
  });

  const filteredRoutingItems = filteredNavItems.filter((item) =>
    ["/dashboard/endpoint", "/dashboard/providers", "/dashboard/combos"].includes(item.href)
  );
  const filteredMonitorItems = [
    ...filteredDebugItems.filter((item) => item.href === "/dashboard/logs"),
    ...filteredNavItems.filter((item) => item.href === "/dashboard/usage"),
    ...filteredNavItems.filter((item) => item.href === "/dashboard/quota"),
  ];
  const filteredWorkbenchItems = filteredWorkshopItems;
  const filteredSystemDebugItems = filteredDebugItems.filter((item) => item.href !== "/dashboard/logs");

  const canOpenMedia = sessionReady && (!isApiKeyUser || permissions.manageMediaProviders);
  const mediaNavItems = [
    ...MEDIA_PROVIDER_KINDS.filter((kind) => VISIBLE_MEDIA_KINDS.includes(kind.id)).map((kind) => ({
      href: `/dashboard/media-providers/${kind.id}`,
      icon: kind.icon,
      label: kind.label,
    })),
    {
      href: COMBINED_WEB_ITEM.href,
      icon: COMBINED_WEB_ITEM.icon,
      label: COMBINED_WEB_ITEM.label,
    },
  ];

  // Settings are an administrator surface, so a key-signed session skips them
  // instead of firing requests it may not read.
  useEffect(() => {
    if (!sessionReady || isApiKeyUser) return;
    useSettingsStore.getState().fetchSettings().then((data) => {
      if (data?.enableTranslator) setEnableTranslator(true);
    });
  }, [sessionReady, isApiKeyUser]);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      <aside
        data-dock={side}
        className={cn(
          "neo-sidebar flex h-full w-[min(18rem,86vw)] min-h-0 flex-col border-border-subtle bg-sidebar shadow-[var(--shadow-elev)] transition-colors duration-300 lg:shadow-none",
          side === "right" ? "border-l" : "border-r"
        )}
      >

        {/* Logo */}
        <div className="flex flex-col gap-2 border-b border-border-subtle px-5 py-5 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 shrink-0 overflow-hidden rounded-[10px]">
              <Image src="/providers/9router-logo.png" alt={APP_CONFIG.name} width={36} height={36} className="size-full object-contain" sizes="36px" priority unoptimized />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold tracking-tight text-text-main">
                {APP_CONFIG.name}
              </h1>
              <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
            </div>
          </Link>
          {sessionReady && isApiKeyUser && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary font-medium">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">passkey</span>
              <span className="truncate">{authStatus?.displayName || "API Key User"}</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav aria-label="Dashboard navigation" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 custom-scrollbar">
          <NavSection title="Traffic" items={filteredRoutingItems} isActive={isActive} onClose={onClose} />
          <NavSection title="Build" items={filteredWorkbenchItems} isActive={isActive} onClose={onClose} />
          <NavSection title="Observe" items={filteredMonitorItems} isActive={isActive} onClose={onClose} />

          {sessionReady && (!isApiKeyUser || filteredSystemItems.length > 0 || filteredSystemDebugItems.length > 0) && (
            <section aria-label="Instance" className="border-t border-border-subtle pt-3">
              <h2 className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                Instance
              </h2>
              <div className="space-y-0.5">
                {filteredSystemItems.map((item) => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    active={isActive(item.href)}
                    onClick={onClose}
                  />
                ))}

                {filteredSystemDebugItems.map((item) => (
                  item.href !== "/dashboard/translator" || enableTranslator ? (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      active={isActive(item.href)}
                      onClick={onClose}
                    />
                  ) : null
                ))}

                {sessionReady && !isApiKeyUser && (
                  <>
                    <NavLink
                      href="/dashboard/profile"
                      icon="manage_accounts"
                      label="Instance Settings"
                      active={isActive("/dashboard/profile")}
                      onClick={onClose}
                    />
                    <NavLink
                      href="/dashboard/experiments"
                      icon="biotech"
                      label="Labs & Experiments"
                      active={isActive("/dashboard/experiments")}
                      onClick={onClose}
                    />
                  </>
                )}
              </div>
            </section>
          )}
          {canOpenMedia && (
            <NavSection
              title="Media Services"
              items={mediaNavItems}
              isActive={isActive}
              onClose={onClose}
              badge={
                MEDIA_PROVIDER_KINDS.some((kind) => VISIBLE_MEDIA_KINDS.includes(kind.id) && kind.isNew)
                  ? "NEW"
                  : undefined
              }
            />
          )}
        </nav>

      </aside>
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  side: PropTypes.oneOf(["left", "right"]),
};
