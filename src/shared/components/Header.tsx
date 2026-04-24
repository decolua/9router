"use client";

import { usePathname, useRouter } from "next/navigation";
import React, { useMemo, Fragment } from "react";
import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import HeaderMenu from "@/shared/components/HeaderMenu";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";

interface BreadcrumbInfo {
  label: string;
  href?: string;
  isCurrent?: boolean;
}

const getPageInfo = (pathname: string): { title: string, breadcrumbs: BreadcrumbInfo[] } => {
  if (!pathname) return { title: "", breadcrumbs: [] };

  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = (AI_PROVIDERS as any)[providerId];
    return {
      title: provider?.name || providerId,
      breadcrumbs: [
        { label: "Media Providers", href: `/dashboard/media-providers/${kindId}` },
        { label: kindConfig?.label || kindId, href: `/dashboard/media-providers/${kindId}` },
        { label: provider?.name || providerId, isCurrent: true },
      ],
    };
  }

  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    return {
      title: kindConfig?.label || kindId,
      breadcrumbs: [
        { label: "System" },
        { label: kindConfig?.label || kindId, isCurrent: true }
      ],
    };
  }

  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo = (OAUTH_PROVIDERS as any)[providerId] || (APIKEY_PROVIDERS as any)[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name,
        breadcrumbs: [
          { label: "Providers", href: "/dashboard/providers" },
          { label: providerInfo.name, isCurrent: true },
        ],
      };
    }
  }

  const staticRoutes: Record<string, string> = {
    "/dashboard/providers": "Providers",
    "/dashboard/combos": "Combos",
    "/dashboard/usage": "Usage",
    "/dashboard/quota": "Quota Tracker",
    "/dashboard/mitm": "MITM Proxy",
    "/dashboard/cli-tools": "CLI Tools",
    "/dashboard/proxy-pools": "Proxy Pools",
    "/dashboard/endpoint": "Endpoint",
    "/dashboard/profile": "Settings",
    "/dashboard/translator": "Translator",
    "/dashboard/console-log": "Console Log",
    "/dashboard": "Dashboard",
  };

  const currentLabel = staticRoutes[pathname] || staticRoutes["/dashboard" + pathname.replace("/dashboard", "")] || "Dashboard";
  
  return {
    title: currentLabel,
    breadcrumbs: [{ label: currentLabel, isCurrent: true }],
  };
};

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();

  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { breadcrumbs } = pageInfo;

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border/50 px-4 bg-background/80 backdrop-blur-md sticky top-0 z-20 transition-all">
      <div className="flex items-center gap-2 flex-1">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4 border-border/50" />
        
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink render={
                <Link href="/dashboard">
                  Dashboard
                </Link>
              } />
            </BreadcrumbItem>
            
            {breadcrumbs.map((crumb, index) => (
              <Fragment key={index}>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  {crumb.isCurrent ? (
                    <BreadcrumbPage>{translate(crumb.label)}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={
                      <Link href={crumb.href || "#"}>
                        {translate(crumb.label)}
                      </Link>
                    } />
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex items-center gap-4">
        <HeaderMenu onLogout={handleLogout} />
      </div>
    </header>
  );
}
