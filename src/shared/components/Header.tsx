"use client";

import { useRouter } from "next/navigation";
import React, { Fragment } from "react";
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
import type { HeaderMeta } from "@/shared/components/headerMeta";
import { translate } from "@/i18n/runtime";

interface HeaderProps {
  meta: HeaderMeta;
}

export default function Header({ meta }: HeaderProps) {
  const router = useRouter();
  const breadcrumbs = meta.breadcrumbs;

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
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border/50 px-4 bg-background/80 backdrop-blur-md sticky top-0 z-20">
      <div className="flex items-center gap-2 flex-1">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5 data-[orientation=vertical]:self-center bg-border/50" />
        
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                <BreadcrumbItem>
                  {crumb.isCurrent || !crumb.href ? (
                    <BreadcrumbPage className="text-sm font-medium">{translate(crumb.label)}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      className="text-sm text-muted-foreground"
                      render={<Link href={crumb.href}>{translate(crumb.label)}</Link>}
                    />
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
