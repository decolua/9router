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

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/auth-files", label: "Auth Files", icon: "vpn_key" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/mitm", label: "MITM", icon: "security" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [showShutdownModal, setShowShutdownModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmd;
  const STATUS_URL = `http://localhost:${UPDATER_CONFIG.statusPort}/update/status`;

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

  const handleUpdate = async () => {
    setIsUpdating(true);
    setShowUpdateModal(false);
    try {
      const res = await fetch("/api/version/update", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || "Update failed. Please run the install command manually.");
        setIsUpdating(false);
        return;
      }
      setIsDisconnected(true);
    } catch (e) {
      setIsDisconnected(true);
    }
  };

  // Poll updater status server while updating (Next server is dead, updater.js is alive)
  useEffect(() => {
    if (!isUpdating || !isDisconnected) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(STATUS_URL, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!stopped) setUpdateStatus(data);
        }
      } catch { /* updater not ready yet or finished */ }
    };
    tick();
    const id = setInterval(tick, UPDATER_CONFIG.statusPollIntervalMs);
    return () => { stopped = true; clearInterval(id); };
  }, [isUpdating, isDisconnected, STATUS_URL]);

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShowShutdownModal(false);
    setIsDisconnected(true);
  };

  return (
    <>
      <aside className="flex w-72 flex-col border-r border-black/5 dark:border-white/5 bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
        {/* Traffic lights */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        </div>

        {/* Logo */}
        <div className="px-6 py-4 flex flex-col gap-2">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded bg-linear-to-br from-[#f97815] to-[#c2590a]">
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
                ↑ New version available: v{updateInfo.latestVersion}
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
        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                isActive(item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface/50 hover:text-text-main"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                {item.icon}
              </span>
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}

          {/* System section */}
          <div className="pt-4 mt-2">
            <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
              System
            </p>

            {/* Media Providers accordion */}
            <button
              onClick={() => setMediaOpen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                pathname.startsWith("/dashboard/media-providers")
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface/50 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[18px]">perm_media</span>
              <span className="text-sm font-medium flex-1 text-left">Media Providers</span>
              <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                expand_more
              </span>
            </button>
            {mediaOpen && (
              <div className="pl-4">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 px-4 py-1.5 rounded-lg transition-all group",
                      pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                        ? "bg-primary/10 text-primary"
                        : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                    )}
                  >
                    <span className="material-symbols-outlined text-[16px]">{kind.icon}</span>
                    <span className="text-sm">{kind.label}</span>
                  </Link>
                ))}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-4 py-1.5 rounded-lg transition-all group",
                    pathname.startsWith(COMBINED_WEB_ITEM.href)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-[16px]">{COMBINED_WEB_ITEM.icon}</span>
                  <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}

            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                  isActive(item.href)
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                )}
              >
                <span
                  className={cn(
                    "material-symbols-outlined text-[18px]",
                    isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                  )}
                >
                  {item.icon}
                </span>
                <span className="text-sm font-medium">{item.label}</span>
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
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                    isActive(item.href)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface/50 hover:text-text-main"
                  )}
                >
                  <span
                    className={cn(
                      "material-symbols-outlined text-[18px]",
                      isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-lg transition-all group",
                isActive("/dashboard/profile")
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface/50 hover:text-text-main"
              )}
            >
              <span
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive("/dashboard/profile") ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                settings
              </span>
              <span className="text-sm font-medium">Settings</span>
            </Link>
          </div>
        </nav>

        {/* Footer section */}
        <div className="p-3 border-t border-black/5 dark:border-white/5">
          {/* Shutdown button */}
          <Button
            variant="outline"
            fullWidth
            icon="power_settings_new"
            onClick={() => setShowShutdownModal(true)}
            className="text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300"
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
        message={`This will close 9Router and install v${updateInfo?.latestVersion || ""} in a separate window. Continue?`}
        confirmText="Update"
        cancelText="Cancel"
        variant="primary"
        loading={isUpdating}
      />

      {/* Disconnected Overlay */}
      {isDisconnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <UpdateProgress
              status={updateStatus}
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              onCopy={() => copy(INSTALL_CMD)}
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

function UpdateProgress({ status, latestVersion, installCmd, copied, onCopy }) {
  const phase = status?.phase || "connecting";
  const done = status?.done === true;
  const success = status?.success === true;
  const attempt = status?.attempt || 0;
  const maxRetries = status?.maxRetries || 0;
  const logTail = status?.logTail || [];
  const errorMsg = status?.error;

  const steps = [
    { key: "stopped", label: "Stopped 9Router server", state: "done" },
    {
      key: "launched",
      label: "Launched background installer",
      state: status ? "done" : "active",
    },
    {
      key: "waiting",
      label: "Waiting for app processes to exit",
      state: phase === "waitingForExit" ? "active" :
        (status && phase !== "starting" ? "done" : "pending"),
    },
    {
      key: "installing",
      label: attempt > 1 ? `Installing v${latestVersion || "latest"} (attempt ${attempt}/${maxRetries})` : `Installing v${latestVersion || "latest"}`,
      state: done ? (success ? "done" : "error") : (phase === "installing" ? "active" : "pending"),
    },
    {
      key: "finished",
      label: done && success ? "Installed — ready to restart" : "Waiting to finish",
      state: done && success ? "done" : (done && !success ? "error" : "pending"),
    },
  ];

  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className={cn(
          "flex items-center justify-center size-11 rounded-full",
          done && success ? "bg-green-500/20 text-green-400" :
          done && !success ? "bg-red-500/20 text-red-400" :
          "bg-blue-500/20 text-blue-400"
        )}>
          <span className={cn(
            "material-symbols-outlined text-[24px]",
            !done && "animate-spin"
          )}>
            {done && success ? "check_circle" : done && !success ? "error" : "progress_activity"}
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">
            {done && success ? "Update Completed" : done && !success ? "Update Failed" : "Updating 9Router"}
          </h2>
          <p className="text-xs text-white/60">
            {done && success
              ? `Installed v${latestVersion || "latest"} successfully`
              : done && !success
                ? (errorMsg || "Installation failed")
                : `Installing v${latestVersion || "latest"} from npm...`}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <ul className="space-y-2 mb-4">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span className={cn(
              "material-symbols-outlined text-[18px] shrink-0",
              s.state === "done" && "text-green-400",
              s.state === "active" && "text-blue-400 animate-pulse",
              s.state === "error" && "text-red-400",
              s.state === "pending" && "text-white/30"
            )}>
              {s.state === "done" ? "check_circle" :
                s.state === "error" ? "cancel" :
                  s.state === "active" ? "radio_button_checked" : "radio_button_unchecked"}
            </span>
            <span className={cn(
              s.state === "pending" ? "text-white/40" : "text-white/90"
            )}>{s.label}</span>
          </li>
        ))}
      </ul>

      {/* Log tail */}
      {logTail.length > 0 && (
        <div className="rounded-md bg-black/50 border border-white/5 p-3 mb-4 max-h-40 overflow-auto">
          <pre className="text-[11px] font-mono text-white/70 whitespace-pre-wrap break-all">
            {logTail.join("\n")}
          </pre>
        </div>
      )}

      {/* Actions */}
      {done && success ? (
        <div className="space-y-2">
          <p className="text-sm text-white/80">
            Run <code className="px-1.5 py-0.5 rounded bg-white/10 text-green-400">9router</code> in your terminal to start the new version.
          </p>
          <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
            Reload Page
          </Button>
        </div>
      ) : done && !success ? (
        <div className="space-y-2">
          <p className="text-sm text-white/80">Run the install command manually:</p>
          <button
            onClick={onCopy}
            className="w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 transition-colors"
          >
            <code className="text-xs font-mono text-amber-400">
              {copied ? "✓ copied!" : installCmd}
            </code>
          </button>
        </div>
      ) : (
        <p className="text-xs text-white/50 text-center">
          This may take 30-60 seconds. Please don't close this window.
        </p>
      )}
    </div>
  );
}

UpdateProgress.propTypes = {
  status: PropTypes.object,
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopy: PropTypes.func.isRequired,
};
