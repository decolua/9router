"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import SidebarSecurityHint from "./SidebarSecurityHint";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

function sidebarLinkClass(active, nested = false) {
  return cn(
    "relative flex items-center gap-3 rounded-lg transition-all group",
    nested ? "px-4 py-1" : "px-3 py-1.5",
    active
      ? "bg-primary/10 text-primary before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-[18px] before:w-[3px] before:rounded-full before:bg-primary"
      : "text-text-muted hover:bg-surface-2 hover:text-text-main",
  );
}

function sidebarIconClass(active, nested = false) {
  return cn(
    "material-symbols-outlined",
    nested ? "text-[16px]" : "text-[18px]",
    active ? "fill-1" : "group-hover:text-primary transition-colors",
  );
}

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "home" },
  { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/mitm", label: "MITM Proxy", icon: "security" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "article" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [showShutdownModal, setShowShutdownModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [releaseInfo, setReleaseInfo] = useState(null);
  const [selectedReleaseVersion, setSelectedReleaseVersion] = useState("");
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [installStarting, setInstallStarting] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;
  const releases = releaseInfo?.releases || [];
  const selectedRelease = releases.find((release) => release.version === selectedReleaseVersion) || releases[0];
  const selectedInstallCmd = selectedRelease?.installCommand || INSTALL_CMD;

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

  useEffect(() => {
    fetch("/api/version/releases")
      .then(res => res.json())
      .then(data => {
        setReleaseInfo(data);
        const firstSelectable = data.releases?.find((release) => !release.isCurrent) || data.releases?.[0];
        if (firstSelectable) setSelectedReleaseVersion(firstSelectable.version);
      })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  // Open manual update panel (no countdown yet — user must click Copy to trigger shutdown)
  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
    setUpdateError("");
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try { await navigator.clipboard.writeText(selectedInstallCmd); } catch { /* clipboard blocked */ }
    copy(selectedInstallCmd);
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
    setInstallStarting(false);
    setUpdateError("");
    setShutdownCountdown(0);
  };

  const handleInstallSelectedRelease = async () => {
    if (!selectedRelease) return;
    setInstallStarting(true);
    setUpdateError("");
    try {
      const res = await fetch("/api/version/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: selectedRelease.version }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to start updater");
      setIsDisconnected(true);
    } catch (error) {
      setInstallStarting(false);
      setUpdateError(error.message || "Failed to start updater");
    }
  };

  // Note: legacy updater poll removed. New flow: copy install cmd + shutdown server,
  // user runs the command manually in another terminal.


  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShowShutdownModal(false);
    setIsDisconnected(true);
  };

  return (
    <>
      <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
        {/* Traffic lights */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2" aria-hidden="true">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        </div>

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
          {(updateInfo || releases.length > 0) && (
            <div className="flex flex-col gap-1.5 rounded p-1 -m-1">
              <span className="text-xs font-semibold text-success dark:text-warning">
                {updateInfo ? `↑ New version available: v${updateInfo.latestVersion}` : "Release history available"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowUpdateModal(true)}
                  className="px-2 py-1 rounded bg-success hover:bg-success/90 dark:bg-warning dark:hover:bg-warning/90 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Versions
                </button>
                <button
                  onClick={() => copy(selectedInstallCmd)}
                  title="Copy install command"
                  className="flex-1 text-left hover:opacity-80 transition-opacity cursor-pointer min-w-0"
                >
                  <code className="block text-[10px] text-green-600/80 dark:text-amber-400/70 font-mono truncate">
                    {copied ? "✓ copied!" : selectedInstallCmd}
                  </code>
                </button>
              </div>
            </div>
          )}
        </div>

        <SidebarSecurityHint />

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={sidebarLinkClass(isActive(item.href))}
            >
              <span
                className={sidebarIconClass(isActive(item.href))}
              >
                {item.icon}
              </span>
              <span className="text-[13px] font-medium">{item.label}</span>
            </Link>
          ))}

          {/* System section */}
          <div className="pt-3 mt-2 space-y-0.5">
            <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              System
            </p>

            {/* Media Providers accordion */}
            <button
              onClick={() => setMediaOpen((v) => !v)}
              aria-expanded={mediaOpen}
              aria-controls="sidebar-media-providers"
              className={cn(sidebarLinkClass(pathname.startsWith("/dashboard/media-providers")), "w-full")}
            >
              <span className="material-symbols-outlined text-[18px]">perm_media</span>
              <span className="text-[13px] font-medium flex-1 text-left">Media Providers</span>
              <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                expand_more
              </span>
            </button>
            {mediaOpen && (
              <div id="sidebar-media-providers" className="pl-4">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    aria-current={pathname.startsWith(`/dashboard/media-providers/${kind.id}`) ? "page" : undefined}
                    className={sidebarLinkClass(pathname.startsWith(`/dashboard/media-providers/${kind.id}`), true)}
                  >
                    <span className={sidebarIconClass(pathname.startsWith(`/dashboard/media-providers/${kind.id}`), true)}>{kind.icon}</span>
                    <span className="text-sm">{kind.label}</span>
                  </Link>
                ))}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  onClick={onClose}
                  aria-current={pathname.startsWith(COMBINED_WEB_ITEM.href) ? "page" : undefined}
                  className={sidebarLinkClass(pathname.startsWith(COMBINED_WEB_ITEM.href), true)}
                >
                  <span className={sidebarIconClass(pathname.startsWith(COMBINED_WEB_ITEM.href), true)}>{COMBINED_WEB_ITEM.icon}</span>
                  <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}

            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={sidebarLinkClass(isActive(item.href))}
              >
                <span className={sidebarIconClass(isActive(item.href))}>
                  {item.icon}
                </span>
                <span className="text-[13px] font-medium">{item.label}</span>
              </Link>
            ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={sidebarLinkClass(isActive(item.href))}
                >
                  <span className={sidebarIconClass(isActive(item.href))}>
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              aria-current={isActive("/dashboard/profile") ? "page" : undefined}
              className={sidebarLinkClass(isActive("/dashboard/profile"))}
            >
              <span className={sidebarIconClass(isActive("/dashboard/profile"))}>
                settings
              </span>
              <span className="text-[13px] font-medium">Settings</span>
            </Link>
          </div>
        </nav>

        {/* Footer section */}
        <div className="p-3 border-t border-border-subtle">
          {/* Shutdown button */}
          <Button
            variant="outline"
            fullWidth
            icon="power_settings_new"
            onClick={() => setShowShutdownModal(true)}
            className="text-danger border-danger/30 hover:bg-danger/10 hover:border-danger/50"
          >
            Shutdown
          </Button>
        </div>
      </aside>

      {/* Shutdown Confirmation Modal */}
      <ConfirmModal
        isOpen={showShutdownModal}
        onClose={() => setShowShutdownModal(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />

      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update 9Router"
        message="Open release history to upgrade or downgrade 9Router from GitHub releases."
        confirmText="Release history"
        cancelText="Cancel"
        variant="primary"
      />

      {/* Disconnected / Updating Overlay */}
      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={selectedInstallCmd}
              releases={releases}
              selectedReleaseVersion={selectedReleaseVersion}
              selectedRelease={selectedRelease}
              onSelectRelease={setSelectedReleaseVersion}
              onInstallSelected={handleInstallSelectedRelease}
              installStarting={installStarting}
              updateError={updateError}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-danger/20 text-danger mx-auto mb-4">
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

function ManualUpdatePanel({ latestVersion, installCmd, releases, selectedReleaseVersion, selectedRelease, onSelectRelease, onInstallSelected, installStarting, updateError, copied, onCopyAndShutdown, onCancel, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-xl rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">system_update_alt</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Release history</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Updater started. 9Router will restart when installation finishes."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : latestVersion
                  ? `Latest GitHub release: v${latestVersion}`
                  : "Upgrade or downgrade from GitHub release history."}
          </p>
        </div>
      </div>

      {releases.length > 0 && (
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50">Target version</span>
          <select
            value={selectedReleaseVersion}
            onChange={(event) => onSelectRelease(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/60"
          >
            {releases.map((release) => (
              <option key={release.version} value={release.version}>
                v{release.version} — {release.direction}
              </option>
            ))}
          </select>
        </label>
      )}

      {selectedRelease && (
        <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
          <div className="flex items-center justify-between gap-3">
            <span>{selectedRelease.name || `v${selectedRelease.version}`}</span>
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-300 capitalize">{selectedRelease.direction}</span>
          </div>
        </div>
      )}

      {updateError && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {updateError}
        </div>
      )}

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
        <li>Click <strong>Install & Restart</strong> for automatic upgrade or downgrade.</li>
        <li>If automatic install is unavailable, copy the command and run it manually.</li>
        <li>9Router restarts after the selected version installs.</li>
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
          <Button variant="outline" onClick={onCopyAndShutdown} disabled={isCountingDown || installStarting}>
            {copied ? "✓ Copied — shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
          <Button variant="primary" fullWidth onClick={onInstallSelected} loading={installStarting} disabled={!selectedRelease || isCountingDown}>
            Install & Restart
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  releases: PropTypes.array,
  selectedReleaseVersion: PropTypes.string,
  selectedRelease: PropTypes.object,
  onSelectRelease: PropTypes.func.isRequired,
  onInstallSelected: PropTypes.func.isRequired,
  installStarting: PropTypes.bool,
  updateError: PropTypes.string,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
