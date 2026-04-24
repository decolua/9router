"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import Sidebar from "../Sidebar";
import Header from "../Header";
import { X, CheckCircle, WarningCircle, Info, Warning } from "@phosphor-icons/react";

const getToastStyle = (type: string) => {
  switch (type) {
    case "success":
      return {
        wrapper: "bg-primary/10 border-primary/20 text-primary",
        icon: <CheckCircle className="size-4.5" weight="bold" />,
      };
    case "error":
      return {
        wrapper: "bg-destructive/10 border-destructive/20 text-destructive",
        icon: <WarningCircle className="size-4.5" weight="bold" />,
      };
    case "warning":
      return {
        wrapper: "bg-amber-500/10 border-amber-500/20 text-amber-500",
        icon: <Warning className="size-4.5" weight="bold" />,
      };
    default:
      return {
        wrapper: "bg-muted/10 border-border/50 text-muted-foreground",
        icon: <Info className="size-4.5" weight="bold" />,
      };
  }
};

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <SidebarProvider defaultOpen={true}>
      <TooltipProvider>
        <div className="flex h-screen w-full overflow-hidden bg-background">
          {/* Notifications */}
          <div className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2 pointer-events-none">
            {notifications.map((n) => {
              const style = getToastStyle(n.type || "info");
              return (
                <div
                  key={n.id}
                  className={`rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md pointer-events-auto animate-in slide-in-from-right-4 duration-300 ${style.wrapper}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{style.icon}</div>
                    <div className="min-w-0 flex-1">
                      {n.title ? <p className="text-xs font-bold uppercase tracking-widest mb-0.5">{n.title}</p> : null}
                      <p className="text-xs font-medium leading-relaxed opacity-90">{n.message}</p>
                    </div>
                    {n.dismissible !== false ? (
                      <button
                        type="button"
                        onClick={() => removeNotification(n.id)}
                        className="text-current opacity-40 hover:opacity-100 transition-opacity"
                        aria-label="Dismiss notification"
                      >
                        <X className="size-4" weight="bold" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <Sidebar />

          <SidebarInset className="flex flex-col flex-1 h-full min-w-0 overflow-hidden transition-all duration-300">
            <Header key={pathname} />
            <div className={`flex-1 overflow-y-auto custom-scrollbar ${pathname === "/dashboard/basic-chat" ? "" : "p-4 lg:p-6"} ${pathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}>
              <div className={`${pathname === "/dashboard/basic-chat" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>
                {children}
              </div>
            </div>
          </SidebarInset>
        </div>
      </TooltipProvider>
    </SidebarProvider>
  );
}
