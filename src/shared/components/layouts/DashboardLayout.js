"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-green-500/25 text-green-700 dark:text-green-300",
      iconWrapper: "bg-green-500/12 text-green-600 dark:text-green-400",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-red-500/25 text-red-700 dark:text-red-300",
      iconWrapper: "bg-red-500/12 text-red-600 dark:text-red-400",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-amber-500/25 text-amber-700 dark:text-amber-300",
      iconWrapper: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-blue-500/25 text-blue-700 dark:text-blue-300",
    iconWrapper: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(92vw,440px)] flex-col gap-2">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`pointer-events-auto rounded-md border bg-surface px-3 py-2.5 shadow-xl ${style.wrapper}`}
            >
              <div className="flex min-h-7 items-center gap-2.5">
                <span className={`material-symbols-outlined flex size-7 shrink-0 items-center justify-center rounded-full text-[17px] leading-none ${style.iconWrapper}`}>{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="mb-0.5 text-xs font-semibold leading-4">{n.title}</p> : null}
                  <p className="break-words text-sm leading-5 text-text-main">{String(n.message || "").replace(/\s*\n+\s*/g, " ")}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="flex size-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-main"
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
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${["/dashboard/basic-chat", "/dashboard/expert-panel"].includes(pathname) ? "" : "px-4 py-6 lg:px-8 lg:py-10"} ${["/dashboard/basic-chat", "/dashboard/expert-panel"].includes(pathname) ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`${["/dashboard/basic-chat", "/dashboard/expert-panel"].includes(pathname) ? "flex-1 h-full flex w-full flex-col" : "w-full"}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}
