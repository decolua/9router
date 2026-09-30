"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import useSettingsStore from "@/store/settingsStore";
import Button from "./Button";
import { ConfirmModal } from "./Modal";

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

// Custom features added by this fork — open-ended, new tools land here too.
const workshopItems = [
  { href: "/dashboard/arena", label: "Compare Models", icon: "swords" },
  { href: "/dashboard/model-editor", label: "Custom Models", icon: "auto_awesome" },
  { href: "/dashboard/plugins", label: "Custom Plugins", icon: "widgets" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "monitor" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
];

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
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = updateInfo?.installCmd || UPDATER_CONFIG.installCmdLatest;

  useEffect(() => {
    fetch("/api/auth/status")
      .then(res => res.json())
      .then(data => setAuthStatus(data))
      .catch(() => {});
  }, []);

  const isApiKeyUser = authStatus?.role === "apikey";
  const permissions = authStatus?.permissions || { manageApiKeys: true, manageModels: true, manageProviders: true, manageTools: true, manageAdvanced: true, managePlugins: true, manageMediaProviders: true, viewUsage: true };

  const filteredNavItems = navItems.filter((item) => {
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
    if (!isApiKeyUser) return true;
    if (item.href === "/dashboard/model-editor" || item.href === "/dashboard/arena") {
      return permissions.manageModels;
    }
    if (item.href === "/dashboard/plugins") return permissions.managePlugins;
    return false;
  });

  const filteredDebugItems = debugItems.filter((item) => {
    if (!isApiKeyUser) return true;
    return permissions.manageAdvanced;
  });

  const filteredSystemItems = systemItems.filter((item) => {
    if (!isApiKeyUser) return true;
    return permissions.manageAdvanced;
  });

  const canOpenMedia = !isApiKeyUser || permissions.manageMediaProviders;

  // Settings and the update check are administrator surfaces, so a key-signed
  // session skips them instead of firing requests it may not read.
  useEffect(() => {
    if (isApiKeyUser) return;
    useSettingsStore.getState().fetchSettings().then((data) => {
      if (data?.enableTranslator) setEnableTranslator(true);
    });
  }, [isApiKeyUser]);

  // Lazy check for new npm version in background after initial render
  useEffect(() => {
    if (isApiKeyUser) return;
    const timer = setTimeout(() => {
      fetch("/api/version")
        .then(res => res.json())
        .then(data => { if (data.hasUpdate) setUpdateInfo(data); })
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, [isApiKeyUser]);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  // Open manual update panel (no countdown yet — user must click Copy to trigger shutdown)
  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try { await navigator.clipboard.writeText(INSTALL_CMD); } catch { /* clipboard blocked */ }
    copy(INSTALL_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  // Note: legacy updater poll removed. New flow: copy install cmd + shutdown server,
  // user runs the command manually in another terminal.


  return (
    <>
      <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">

        {/* Logo */}
        <div className="px-6 py-4 flex flex-col gap-2">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)]">
              <span className="material-symbols-outlined text-white text-[20px]">hub</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold tracking-tight text-text-main">
                {APP_CONFIG.name}
              </h1>
              <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
            </div>
          </Link>
          {isApiKeyUser && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary font-medium">
              <span className="material-symbols-outlined text-[15px]">key</span>
              <span className="truncate">{authStatus?.displayName || "API Key User"}</span>
            </div>
          )}
          {updateInfo && !isApiKeyUser && (
            <div className="flex flex-col gap-1.5 rounded p-1 -m-1">
              <span className="text-xs font-semibold text-green-600 dark:text-amber-500">
                ↑ {updateInfo.behindBy ? `Update available: ${updateInfo.behindBy} commit${updateInfo.behindBy > 1 ? 's' : ''} behind` : `New version: ${updateInfo.latestVersion}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowUpdateModal(true)}
                  className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 dark:bg-amber-500 dark:hover:bg-amber-600 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Update now
                </button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="flex-1 text-left hover:opacity-80 transition-opacity cursor-pointer min-w-0"
                >
                  <code className="block text-[10px] text-green-600/80 dark:text-amber-400/70 font-mono truncate">
                    {copied ? "✓ copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
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

          {/* FEATURE+ section — custom tools added by this fork */}
          {filteredWorkshopItems.length > 0 && (
            <div className="pt-3 mt-2 space-y-0.5">
              <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
                FEATURE+
              </p>
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

          {/* System section — an API key session sees only the parts it may use */}
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
              {!isApiKeyUser && (
              <NavLink
                href='/dashboard/profile'
                icon='settings'
                label='9Router Settings'
                active={isActive('/dashboard/profile')}
                onClick={onClose}
              />
              )}
            </div>
          )}
        </nav>

      </aside>

      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update 9Router"
        message={`Show install command for v${updateInfo?.latestVersion || ""}? You can copy it and shutdown to install manually.`}
        confirmText="Show Command"
        cancelText="Cancel"
        variant="primary"
      />

      {/* Disconnected / Updating Overlay */}
      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                <span className="material-symbols-outlined text-[32px]">power_off</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Server Disconnected</h2>
              <p className="text-text-muted mb-6">The proxy server has been stopped.</p>
              <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};

function ManualUpdatePanel({ latestVersion, installCmd, copied, onCopyAndShutdown, onCancel, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">content_copy</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Update 9Router{latestVersion ? ` to v${latestVersion}` : ""}</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
        <li>Click <strong>Copy & Shutdown</strong> below.</li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>Run <code className="px-1 rounded bg-white/10 text-green-400">9router</code> again after install.</li>
      </ol>

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={isCountingDown}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={onCopyAndShutdown} disabled={isCountingDown}>
            {copied ? "✓ Copied — shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
