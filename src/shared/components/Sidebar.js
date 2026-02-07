"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import Button from "./Button";
import { ConfirmModal } from "./Modal";

const navItems = [
  { href: "/dashboard/endpoint", labelKey: "nav.endpoint", icon: "api" },
  { href: "/dashboard/providers", labelKey: "nav.providers", icon: "dns" },
  { href: "/dashboard/combos", labelKey: "nav.combos", icon: "layers" },
  { href: "/dashboard/usage", labelKey: "nav.usage", icon: "bar_chart" },
  { href: "/dashboard/cli-tools", labelKey: "nav.cliTools", icon: "terminal" },
];

// Debug items (only show when ENABLE_REQUEST_LOGS=true)
const debugItems = [
  { href: "/dashboard/translator", labelKey: "nav.translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/profile", labelKey: "nav.settings", icon: "settings" },
];

export default function Sidebar({ onClose, authType: initialAuthType = "admin" }) {
  const pathname = usePathname();
  const t = useTranslations();
  const [showShutdownModal, setShowShutdownModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [authType, setAuthType] = useState(initialAuthType);

  // Check if debug mode is enabled
  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => setShowDebug(data?.enableRequestLogs === true))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialAuthType) return;
    fetch("/api/auth/session")
      .then(res => res.json())
      .then(data => setAuthType(data?.authType || "admin"))
      .catch(() => {});
  }, [initialAuthType]);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

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

  const isKeyUser = authType === "apiKey";
  const displayNavItems = isKeyUser
    ? [{ href: "/dashboard/key", labelKey: "nav.myKey", icon: "vpn_key" }]
    : navItems;

  return (
    <>
      <aside className="flex w-72 flex-col border-r border-black/5 dark:border-white/5 bg-vibrancy backdrop-blur-xl transition-colors duration-300">
        {/* Traffic lights */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-2">
          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
        </div>

        {/* Logo */}
        <div className="px-6 py-4">
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
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
          {displayNavItems.map((item) => (
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
              <span className="text-sm font-medium">{t(item.labelKey)}</span>
            </Link>
          ))}

          {/* Debug section (only show when ENABLE_REQUEST_LOGS=true) */}
          {!isKeyUser && showDebug && (
            <div className="pt-4 mt-2">
              <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
                {t("nav.debug")}
              </p>
              {debugItems.map((item) => (
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
                  <span className="text-sm font-medium">{t(item.labelKey)}</span>
                </Link>
              ))}
            </div>
          )}

          {/* System section */}
          {!isKeyUser && (
            <div className="pt-4 mt-2">
              <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2">
                {t("nav.system")}
              </p>
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
                  <span className="text-sm font-medium">{t(item.labelKey)}</span>
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/* Footer section */}
        {!isKeyUser && (
          <div className="p-3 border-t border-black/5 dark:border-white/5">
            {/* Info message */}
            <div className="flex items-start gap-2 p-2 rounded-lg bg-surface/50 mb-2">
              <div className="flex items-center justify-center size-6 rounded-md bg-blue-500/10 text-blue-500 shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[14px]">info</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-text-main leading-relaxed">
                  {t("sidebar.serviceRunning")}
                </span>
              </div>
            </div>

            {/* Shutdown button */}
            <Button
              variant="outline"
              fullWidth
              icon="power_settings_new"
              onClick={() => setShowShutdownModal(true)}
              className="text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300"
            >
              {t("sidebar.shutdown")}
            </Button>
          </div>
        )}
      </aside>

      {!isKeyUser && (
        <>
          {/* Shutdown Confirmation Modal */}
          <ConfirmModal
            isOpen={showShutdownModal}
            onClose={() => setShowShutdownModal(false)}
            onConfirm={handleShutdown}
            title={t("sidebar.closeProxyTitle")}
            message={t("sidebar.closeProxyMessage")}
            confirmText={t("sidebar.close")}
            cancelText={t("common.cancel")}
            variant="danger"
            loading={isShuttingDown}
          />

          {/* Disconnected Overlay */}
          {isDisconnected && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <div className="text-center p-8">
                <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                  <span className="material-symbols-outlined text-[32px]">power_off</span>
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">{t("sidebar.serverDisconnected")}</h2>
                <p className="text-text-muted mb-6">{t("sidebar.serverStopped")}</p>
                <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                  {t("sidebar.reloadPage")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  authType: PropTypes.string,
};
