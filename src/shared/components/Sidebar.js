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
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt", "systemone"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

// Custom features added by this fork - open-ended, new tools land here too.
const workshopItems = [
  { href: "/dashboard/arena", label: "Compare Models", icon: "swords" },
  { href: "/dashboard/model-editor", label: "Custom Models", icon: "auto_awesome" },
  { href: "/dashboard/auto-harvester", label: "Auto Harvester", icon: "radar" },
];

// Security Log and Inbox Error live in the bell, not the menu - they are
// conditions to review, not places you visit to work.
const debugItems = [
  { href: "/dashboard/logs", label: "Error & Console Logs", icon: "receipt_long" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
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
      className={cn(
        "relative flex min-w-0 items-center gap-3 rounded-[10px] transition-all group",
        sub ? "pl-7 pr-3 py-[6px]" : "px-3 py-[7px]",
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
          "material-symbols-outlined shrink-0 leading-none",
          sub ? "size-4 text-[16px]" : "size-[18px] text-[18px]",
          active ? "fill-1 text-primary" : "group-hover:text-primary transition-colors"
        )}
      >
        {icon}
      </span>
      <span className="text-[13px] font-medium leading-none min-w-0 truncate" title={label}>{label}</span>
    </Link>
  );
}

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
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

  const canOpenMedia = sessionReady && (!isApiKeyUser || permissions.manageMediaProviders);

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
      <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">

        {/* Logo */}
        <div className="px-6 py-4 flex flex-col gap-2">
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
              <span className="material-symbols-outlined text-[15px]">key</span>
              <span className="truncate">{authStatus?.displayName || "API Key User"}</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
              onClick={onClose}
            />
          ))}

          {/* Custom tools added by this fork */}
          {filteredWorkshopItems.length > 0 && (
            <div className="pt-3 mt-2 space-y-0.5">
              {filteredWorkshopItems.map((item) => (
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
          )}

          {/* System section - an API key session sees only the parts it may use */}
          {(!isApiKeyUser || canOpenMedia || filteredSystemItems.length > 0 || filteredDebugItems.length > 0) && (
            <div className="pt-3 mt-2 space-y-0.5">
              <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
                System
              </p>

              {/* Media Providers accordion */}
              {canOpenMedia && (
              <button
                onClick={() => setMediaOpen((v) => !v)}
                className={cn(
                  "relative w-full flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-all group",
                  pathname.startsWith("/dashboard/media-providers")
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                {pathname.startsWith("/dashboard/media-providers") && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
                )}
                <span className="material-symbols-outlined size-[18px] text-[18px] leading-none shrink-0">perm_media</span>
                <span className="text-[13px] font-medium leading-none flex-1 text-left min-w-0 truncate" title="Media Providers">Media Providers</span>
                {MEDIA_PROVIDER_KINDS.some((k) => VISIBLE_MEDIA_KINDS.includes(k.id) && k.isNew) && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[3px] bg-green-500/15 text-green-400">NEW</span>
                )}
                <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                  expand_more
                </span>
              </button>
              )}
              {canOpenMedia && mediaOpen && (
                <div className="pl-4">
                  {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                    <NavLink
                      key={kind.id}
                      href={`/dashboard/media-providers/${kind.id}`}
                      icon={kind.icon}
                      label={kind.label}
                      active={pathname.startsWith(`/dashboard/media-providers/${kind.id}`)}
                      onClick={onClose}
                      sub
                    />
                  ))}
                  <NavLink
                    key={COMBINED_WEB_ITEM.id}
                    href={COMBINED_WEB_ITEM.href}
                    icon={COMBINED_WEB_ITEM.icon}
                    label={COMBINED_WEB_ITEM.label}
                    active={pathname.startsWith(COMBINED_WEB_ITEM.href)}
                    onClick={onClose}
                    sub
                  />
                </div>
              )}

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

              {/* Debug items (inside System section, before Settings) */}
              {filteredDebugItems.map((item) => {
                const show = item.href !== '/dashboard/translator' || enableTranslator;
                return show ? (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    active={isActive(item.href)}
                    onClick={onClose}
                  />
                ) : null;
              })}


              {/* Settings */}
              {sessionReady && !isApiKeyUser && (
              <>
              <NavLink
                href='/dashboard/profile'
                icon='settings'
                label='9Router Settings'
                active={isActive('/dashboard/profile')}
                onClick={onClose}
              />
              <NavLink
                href='/dashboard/experiments'
                icon='science'
                label='Experiment Features'
                active={isActive('/dashboard/experiments')}
                onClick={onClose}
              />
              </>
              )}
            </div>
          )}
        </nav>

      </aside>
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};

