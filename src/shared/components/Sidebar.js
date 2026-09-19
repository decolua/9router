"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "./Button";
import { ConfirmModal } from "./Modal";

// Poll the detached updater's status endpoint while the server is down.
// Fails quietly after maxAttempts (updater unreachable: manual flow, https page,
// or the process already left) — resolve(null) means "no live status available".
function pollUpdaterStatus(signal, onStatus, maxAttempts = 600) {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${UPDATER_CONFIG.statusPort}/update/status`;
    let attempts = 0;
    const tick = () => {
      if (signal.aborted) return resolve(null);
      attempts += 1;
      fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .then((status) => {
          if (signal.aborted) return resolve(null);
          if (status) {
            onStatus(status);
            if (status.done) return resolve(status);
          }
          if (attempts >= maxAttempts) return resolve(null);
          setTimeout(tick, UPDATER_CONFIG.statusPollIntervalMs);
        })
        .catch(() => {
          if (signal.aborted || attempts >= maxAttempts) return resolve(null);
          setTimeout(tick, UPDATER_CONFIG.statusPollIntervalMs);
        });
    };
    tick();
  });
}

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
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
  const [autoUpdating, setAutoUpdating] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState(null);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = updateInfo?.installCmd || UPDATER_CONFIG.installCmdLatest;

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  // Lazy check for new npm version on mount
  useEffect(() => {
    fetch("/api/version")
      .then(res => res.json())
      .then(data => { if (data.hasUpdate) setUpdateInfo(data); })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  // Auto update: hand off to the detached updater (production CLI install).
  // Falls back to the manual copy-command panel when the endpoint refuses
  // (dev build) or errors, so the user always has a working path.
  const updateAbort = useRef(null);
  useEffect(() => () => updateAbort.current?.abort(), []);

  const handleUpdate = async () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
    setAutoUpdating(true);
    try {
      const res = await fetch("/api/version/update", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn("Auto update unavailable:", data.message || res.status);
        setAutoUpdating(false);
        return; // stay on the manual panel
      }
      // Server will exit shortly; watch the detached updater until it finishes
      setIsDisconnected(true);
      setIsUpdating(false);
      updateAbort.current = new AbortController();
      const status = await pollUpdaterStatus(updateAbort.current.signal, setUpdaterStatus);
      if (status?.success) {
        globalThis.location.reload();
      } else if (status) {
        setUpdaterStatus(status);
      } else {
        // Updater never became reachable: let the plain disconnected overlay stand
        setAutoUpdating(false);
      }
    } catch {
      // Expected once the server exits mid-request; updater takes over
      setIsDisconnected(true);
      setIsUpdating(false);
      setAutoUpdating(false);
    }
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
          {updateInfo && (
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
          {navItems.map((item) => (
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
          <div className="pt-3 mt-2 space-y-0.5">
            <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              FEATURE+
            </p>
            {workshopItems.map((item) => (
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

          {/* System section */}
          <div className="pt-3 mt-2 space-y-0.5">
            <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              System
            </p>

            {/* Media Providers accordion */}
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
              <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                expand_more
              </span>
            </button>
            {mediaOpen && (
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

            {systemItems.map((item) => (
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
            {debugItems.map((item) => {
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
            <NavLink
              href='/dashboard/profile'
              icon='settings'
              label='9Router Settings'
              active={isActive('/dashboard/profile')}
              onClick={onClose}
            />
          </div>
        </nav>

      </aside>

      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update 9Router"
        message={`Auto update to v${updateInfo?.latestVersion || ""}? The updater installs the new version and restarts 9Router automatically.`}
        confirmText="Update Now"
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
              {autoUpdating && !updaterStatus?.done ? (
                <>
                  <div className="flex items-center justify-center size-16 rounded-full bg-primary/20 text-primary mx-auto mb-4 animate-pulse">
                    <span className="material-symbols-outlined text-[32px]">system_update_alt</span>
                  </div>
                  <h2 className="text-xl font-semibold text-white mb-2">Updating 9Router{updateInfo?.latestVersion ? ` to v${updateInfo.latestVersion}` : ""}</h2>
                  <p className="text-text-muted mb-2">
                    {updaterStatus?.phase === "installing"
                      ? "Installing the new version..."
                      : updaterStatus?.phase === "waitingForExit"
                        ? "Waiting for the server to stop..."
                        : "Preparing the update..."}
                  </p>
                  {(updaterStatus?.logTail || []).length > 0 && (
                    <pre className="max-w-lg max-h-32 overflow-auto text-left text-xs font-mono text-white/50 bg-white/5 rounded-lg p-3 mx-auto whitespace-pre-wrap">{updaterStatus.logTail.slice(-4).join("\n")}</pre>
                  )}
                </>
              ) : updaterStatus?.done && !updaterStatus?.success ? (
                <>
                  <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                    <span className="material-symbols-outlined text-[32px]">error</span>
                  </div>
                  <h2 className="text-xl font-semibold text-white mb-2">Auto Update Failed</h2>
                  <pre className="max-w-lg max-h-40 overflow-auto text-left text-xs font-mono text-red-300 bg-white/5 rounded-lg p-3 mb-4 mx-auto whitespace-pre-wrap">
                    {Array.isArray(updaterStatus.logTail) && updaterStatus.logTail.length > 0
                      ? updaterStatus.logTail.slice(-8).join("\n")
                      : updaterStatus.error || "Installer error"}
                  </pre>
                  <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                    Reload Page
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                    <span className="material-symbols-outlined text-[32px]">power_off</span>
                  </div>
                  <h2 className="text-xl font-semibold text-white mb-2">Server Disconnected</h2>
                  <p className="text-text-muted mb-6">The proxy server has been stopped.</p>
                  <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                    Reload Page
                  </Button>
                </>
              )}
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
