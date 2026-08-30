"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import { useVerificationStore, isValidVerificationUrl } from "@/store/verificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";
import Button from "../Button";
function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const verificationData = useVerificationStore((state) => state.latestVerification);
  const setFromPayload = useVerificationStore((state) => state.setFromPayload);
  const [dismissedKey, setDismissedKey] = useState(null);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  useEffect(() => {
    let es;
    try {
      es = new EventSource("/api/usage/stream");
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setFromPayload(data);
          if (!data.antigravityVerification && !data.antigravityVerifications) {
            setDismissedKey(null);
          }
        } catch {
          // ignore json parse error
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects
      };
    } catch {
      // EventSource not supported or initialization failed
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  }, []);

  const currentVerificationKey = verificationData
    ? `${verificationData.connectionId || ""}-${verificationData.url}`
    : null;
  const showVerification =
    verificationData &&
    isValidVerificationUrl(verificationData.url) &&
    dismissedKey !== currentVerificationKey;

  const handleOpenVerification = () => {
    if (verificationData && isValidVerificationUrl(verificationData.url)) {
      window.open(verificationData.url, "_blank", "noopener,noreferrer");
    }
  };
  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      <div className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
        {showVerification && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-lg border px-3.5 py-3 shadow-lg backdrop-blur-sm border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          >
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[20px] leading-5 text-amber-600 dark:text-amber-400 shrink-0">
                verified_user
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    Antigravity
                  </span>
                  {verificationData.account ? (
                    <span className="text-[11px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 truncate max-w-[180px]">
                      {verificationData.account}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-amber-800/90 dark:text-amber-200/90 mb-2.5">
                  Google account verification required to proceed.
                </p>
                <div>
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full text-xs font-medium !bg-amber-600 hover:!bg-amber-700 !text-white"
                    onClick={handleOpenVerification}
                  >
                    Verify account
                  </Button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDismissedKey(currentVerificationKey)}
                className="text-amber-800/70 hover:text-amber-900 dark:text-amber-200/70 dark:hover:text-amber-100 p-0.5"
                aria-label="Dismiss verification alert"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </div>
        )}
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] leading-5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="text-current/70 hover:text-current"
                    aria-label="Dismiss notification"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Sidebar - Mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform lg:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-300 isolate">
        {/* Faint grid background */}
        <div className="landing-grid absolute inset-0 pointer-events-none -z-10" aria-hidden="true" />
        <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${pathname === "/dashboard/basic-chat" ? "" : "p-6 lg:p-10"} ${pathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`${pathname === "/dashboard/basic-chat" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}
