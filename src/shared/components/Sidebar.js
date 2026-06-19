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
import NineRemotePromoModal from "./NineRemotePromoModal";

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];

// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const LLM_ITEMS = [
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/model-fallbacks", label: "Model Fallbacks", icon: "sync_alt" },
];

const MCP_ITEMS = [
  { href: "/dashboard/mcp-gateway/servers", label: "Servers", icon: "dns" },
  { href: "/dashboard/mcp-gateway/keys", label: "Keys", icon: "vpn_key" },
];

const OBSERVABILITY_ITEMS = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
];

const COMPRESS_ITEMS = [
  { href: "/dashboard/system/compress/rtk", label: "RTK", icon: "bolt" },
  { href: "/dashboard/system/compress/headroom", label: "Headroom", icon: "compress" },
  { href: "/dashboard/system/compress/caveman", label: "Caveman", icon: "format_size" },
  { href: "/dashboard/system/compress/ponytail", label: "Ponytail", icon: "low_priority" },
];

const SYSTEM_ITEMS = [
  { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
  { href: "/dashboard/system/api-keys", label: "API Keys", icon: "vpn_key" },
  { href: "/dashboard/mitm", label: "MITM", icon: "security" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState({
    llm: true, mcp: false, media: false, observability: false,
    compress: false, system: false,
  });
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const toggleSection = (key) => setOpenSections((s) => ({ ...s, [key]: !s[key] }));

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;


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
    if (!pathname) return false;
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
        {/* Traffic lights */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2">
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
        <nav className="flex-1 px-4 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
          {/* LLM accordion */}
          <AccordionSection
            label="LLM" icon="hub" isOpen={openSections.llm}
            onToggle={() => toggleSection("llm")}
            isActive={pathname?.startsWith("/dashboard/providers") || pathname?.startsWith("/dashboard/combos") || pathname?.startsWith("/dashboard/model-fallbacks") || pathname?.startsWith("/dashboard/mcp-gateway")}
            onClose={onClose}
          >
            {LLM_ITEMS.map((item) => (
              <SubLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                active={isActive(item.href)} onClose={onClose} />
            ))}

            {/* Nested MCP Gateway accordion */}
            <div className="mt-1">
              <button
                onClick={() => toggleSection("mcp")}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                  pathname?.startsWith("/dashboard/mcp-gateway")
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                <span className="material-symbols-outlined text-[18px]">account_tree</span>
                <span className="text-[13px] font-medium flex-1 text-left">MCP Gateway</span>
                <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: openSections.mcp ? "rotate(180deg)" : "rotate(0deg)" }}>
                  expand_more
                </span>
              </button>
              {openSections.mcp && (
                <div className="pl-4">
                  {MCP_ITEMS.map((item) => (
                    <SubLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                      active={pathname?.startsWith(item.href)} onClose={onClose} indent />
                  ))}
                </div>
              )}
            </div>
          </AccordionSection>

          {/* Observability accordion */}
          <AccordionSection
            label="Observability" icon="monitoring" isOpen={openSections.observability}
            onToggle={() => toggleSection("observability")}
            isActive={pathname?.startsWith("/dashboard/console-log") || pathname?.startsWith("/dashboard/usage") || pathname?.startsWith("/dashboard/quota")}
            onClose={onClose}
          >
            {OBSERVABILITY_ITEMS.map((item) => (
              <SubLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                active={isActive(item.href)} onClose={onClose} />
            ))}
          </AccordionSection>

          {/* Media Providers accordion */}
          <AccordionSection
            label="Media Providers" icon="perm_media" isOpen={openSections.media}
            onToggle={() => toggleSection("media")}
            isActive={pathname?.startsWith("/dashboard/media-providers")}
            onClose={onClose}
          >
            {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
              <SubLink key={kind.id} href={`/dashboard/media-providers/${kind.id}`} icon={kind.icon} label={kind.label}
                active={pathname?.startsWith(`/dashboard/media-providers/${kind.id}`)} onClose={onClose} />
            ))}
            <SubLink href={COMBINED_WEB_ITEM.href} icon={COMBINED_WEB_ITEM.icon} label={COMBINED_WEB_ITEM.label}
              active={pathname?.startsWith(COMBINED_WEB_ITEM.href)} onClose={onClose} />
          </AccordionSection>

          {/* Compression accordion */}
          <AccordionSection
            label="Compression" icon="compress" isOpen={openSections.compress}
            onToggle={() => toggleSection("compress")}
            isActive={pathname?.startsWith("/dashboard/system/compress")}
            onClose={onClose}
          >
            {COMPRESS_ITEMS.map((item) => (
              <SubLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                active={pathname?.startsWith(item.href)} onClose={onClose} />
            ))}
          </AccordionSection>

          {/* System accordion */}
          <AccordionSection
            label="System" icon="settings_applications" isOpen={openSections.system}
            onToggle={() => toggleSection("system")}
            isActive={
              pathname === "/dashboard" || pathname?.startsWith("/dashboard/endpoint") ||
              pathname?.startsWith("/dashboard/system/api-keys") || pathname?.startsWith("/dashboard/mitm") ||
              pathname?.startsWith("/dashboard/cli-tools") || pathname?.startsWith("/dashboard/proxy-pools") ||
              pathname?.startsWith("/dashboard/skills") || (enableTranslator && pathname?.startsWith("/dashboard/translator"))
            }
            onClose={onClose}
          >
            {SYSTEM_ITEMS.map((item) => (
              <SubLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                active={isActive(item.href)} onClose={onClose} />
            ))}
            {/* Translator gated */}
            {enableTranslator && (
              <SubLink href="/dashboard/translator" icon="translate" label="Translator"
                active={pathname?.startsWith("/dashboard/translator")} onClose={onClose} />
            )}
          </AccordionSection>

          {/* Remote + Settings pinned at bottom */}
          <div className="pt-3 mt-2 space-y-0.5 border-t border-border-subtle">
            <button
              onClick={() => setShowRemoteModal(true)}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group w-full",
                "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">computer</span>
              <span className="text-[13px] font-medium">Remote</span>
            </button>

            <Link
              href="/dashboard/profile"
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                isActive("/dashboard/profile")
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className={cn(
                "material-symbols-outlined text-[18px]",
                isActive("/dashboard/profile") ? "fill-1" : "group-hover:text-primary transition-colors"
              )}>
                settings
              </span>
              <span className="text-[13px] font-medium">Settings</span>
            </Link>
          </div>
        </nav>

      </aside>

      {/* Remote Promo Modal */}
      <NineRemotePromoModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />

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

function SubLink({ href, icon, label, active, onClose, indent }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={cn(
        "flex items-center gap-3 py-1 rounded-lg transition-all group",
        indent ? "px-4" : "px-3",
        active
          ? "bg-primary/10 text-primary"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      )}
    >
      <span
        className={cn(
          "material-symbols-outlined",
          indent ? "text-[16px]" : "text-[18px]",
          active ? "fill-1" : "group-hover:text-primary transition-colors"
        )}
      >
        {icon}
      </span>
      <span className={indent ? "text-sm" : "text-[13px] font-medium"}>{label}</span>
    </Link>
  );
}

SubLink.propTypes = {
  href: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  active: PropTypes.bool,
  onClose: PropTypes.func,
  indent: PropTypes.bool,
};

function AccordionSection({ label, icon, isOpen, onToggle, isActive, onClose, children }) {
  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-1 rounded-lg transition-all group",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-text-muted hover:bg-surface-2 hover:text-text-main"
        )}
      >
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
        <span className="text-[13px] font-medium flex-1 text-left">{label}</span>
        <span
          className="material-symbols-outlined text-[14px] transition-transform"
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          expand_more
        </span>
      </button>
      {isOpen && <div className="pl-2">{children}</div>}
    </div>
  );
}

AccordionSection.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  isOpen: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  isActive: PropTypes.bool,
  onClose: PropTypes.func,
  children: PropTypes.node,
};
