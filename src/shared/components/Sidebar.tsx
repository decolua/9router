"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  ChartBar, 
  CaretRight, 
  Database, 
  Globe, 
  Stack, 
  Desktop, 
  Power, 
  MagnifyingGlass, 
  Gear, 
  ShieldCheck, 
  Terminal, 
  Lightning,
  Command,
  DotsThree,
  Headphones
} from "@phosphor-icons/react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuBadge,
  SidebarRail,
  useSidebar
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VISIBLE_MEDIA_KINDS = ["embedding", "tts"];

export default function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const [showShutdownModal, setShowShutdownModal] = React.useState(false);
  const [isShuttingDown, setIsShuttingDown] = React.useState(false);
  const [isDisconnected, setIsDisconnected] = React.useState(false);
  const [enableTranslator, setEnableTranslator] = React.useState(false);

  // Read direct to avoid hydration mismatch and extra API call if already known
  React.useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch (e) {}
    setIsShuttingDown(false);
    setShowShutdownModal(false);
    setIsDisconnected(true);
  };

  const isActive = (url: string) => {
    if (url === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(url);
  };

  const navData = React.useMemo(() => ({
    user: { name: "System Admin", email: "admin@8router.ai", avatar: "/favicon.svg" },
    teams: [{ name: "8Router Proxy", logo: Command, plan: `v${APP_CONFIG.version}` }],
    navMain: [
      { title: "Dịch vụ chính", items: [{ title: "Endpoint", url: "/dashboard/endpoint", icon: Lightning, badge: "API" }, { title: "Nhà cung cấp", url: "/dashboard/providers", icon: Database }, { title: "Kết hợp", url: "/dashboard/combos", icon: Stack }] },
      { title: "Giám sát", items: [{ title: "Thống kê", url: "/dashboard/usage", icon: ChartBar }, { title: "Quota", url: "/dashboard/quota", icon: MagnifyingGlass }] },
      { title: "Phát triển", items: [{ title: "MITM Proxy", url: "/dashboard/mitm", icon: ShieldCheck }, { title: "Công cụ", url: "/dashboard/cli-tools", icon: Terminal }] },
    ],
    system: [{ title: "Proxy Pools", url: "/dashboard/proxy-pools", icon: Globe }, { title: "Nhật ký Console", url: "/dashboard/console-log", icon: Desktop }, ...(enableTranslator ? [{ title: "Translator", url: "/dashboard/translator", icon: Globe }] : [])]
  }), [enableTranslator]);

  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              {(() => {
                const TeamLogo = navData.teams[0].logo;
                return (
                  <SidebarMenuButton size="lg" render={
                    <Link href="/dashboard">
                      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shrink-0 shadow-none">
                        <TeamLogo className="size-4" weight="bold" />
                      </div>
                      <div className="grid flex-1 text-left text-sm leading-tight ml-1">
                        <span className="truncate font-bold uppercase tracking-tight text-foreground">{navData.teams[0].name}</span>
                        <span className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{navData.teams[0].plan}</span>
                      </div>
                    </Link>
                  } />
                );
              })()}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {navData.navMain.map((group) => (
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40 px-4">{group.title}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton isActive={isActive(item.url)} tooltip={item.title} render={
                      <Link href={item.url} className="font-bold uppercase tracking-widest text-[11px]">
                        <item.icon data-icon="inline-start" weight={isActive(item.url) ? "fill" : "bold"} className={cn("size-4", isActive(item.url) ? "text-primary" : "text-muted-foreground")} />
                        <span>{item.title}</span>
                      </Link>
                    } />
                    {item.badge && <SidebarMenuBadge className="rounded-none bg-primary/10 text-primary border-none font-bold text-[9px] px-1 h-4">{item.badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}

          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-40 px-4">Hệ thống</SidebarGroupLabel>
            <SidebarMenu>
              <Collapsible defaultOpen={pathname.includes("media-providers")} className="group/collapsible" render={
                <SidebarMenuItem>
                  <CollapsibleTrigger render={
                    <SidebarMenuButton tooltip="Media Providers" className="font-bold uppercase tracking-widest text-[11px]">
                      <Headphones data-icon="inline-start" weight="bold" />
                      <span>Media Providers</span>
                      <CaretRight data-icon="inline-end" className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" weight="bold" />
                    </SidebarMenuButton>
                  } />
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                        <SidebarMenuSubItem key={kind.id}>
                          <SidebarMenuSubButton isActive={pathname.includes(kind.id)} render={
                            <Link href={`/dashboard/media-providers/${kind.id}`} className="font-bold uppercase tracking-widest text-[10px]">
                              <span>{kind.label}</span>
                            </Link>
                          } />
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              } />

              {navData.system.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton isActive={isActive(item.url)} tooltip={item.title} render={
                    <Link href={item.url} className="font-bold uppercase tracking-widest text-[11px]">
                      <item.icon data-icon="inline-start" weight={isActive(item.url) ? "fill" : "bold"} className={cn("size-4", isActive(item.url) ? "text-primary" : "text-muted-foreground")} />
                      <span>{item.title}</span>
                    </Link>
                  } />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <SidebarMenuButton size="lg">
                    <Avatar className="h-8 w-8 rounded-none border border-border/50">
                      <AvatarImage src={navData.user.avatar} alt={navData.user.name} />
                      <AvatarFallback className="rounded-none bg-muted/20 text-muted-foreground">SA</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight ml-1">
                      <span className="truncate font-bold uppercase tracking-tight text-foreground">{navData.user.name}</span>
                      <span className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{navData.user.email}</span>
                    </div>
                    <DotsThree data-icon="inline-end" className="ml-auto opacity-40" weight="bold" />
                  </SidebarMenuButton>
                } />
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-none shadow-none border-border/50 bg-background/95 backdrop-blur-md"
                  side={isMobile ? "bottom" : "right"}
                  align="end"
                  sideOffset={4}
                >
                  <div className="flex items-center gap-2 px-2 py-3 border-b border-border/40 bg-muted/10">
                    <Avatar className="h-9 w-9 rounded-none border border-border/50 shadow-none">
                      <AvatarImage src={navData.user.avatar} alt={navData.user.name} />
                      <AvatarFallback className="rounded-none">SA</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-bold uppercase tracking-tight text-foreground">{navData.user.name}</span>
                      <span className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">{navData.user.email}</span>
                    </div>
                  </div>
                  <DropdownMenuSeparator className="mx-0 bg-border/20" />
                  <DropdownMenuGroup>
                    <DropdownMenuItem render={
                      <Link href="/dashboard/profile" className="flex items-center gap-2 py-2.5 cursor-pointer font-bold uppercase tracking-widest text-[10px] hover:bg-primary/5 hover:text-primary transition-colors">
                        <Gear data-icon="inline-start" className="size-4" weight="bold" />
                        <span>Node Infrastructure</span>
                      </Link>
                    } />
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="mx-0 bg-border/20" />
                  <DropdownMenuItem onClick={() => setShowShutdownModal(true)} className="text-destructive focus:text-destructive py-2.5 cursor-pointer gap-2 font-bold uppercase tracking-widest text-[10px] focus:bg-destructive/10">
                    <Power data-icon="inline-start" className="size-4" weight="bold" />
                    <span>De-provision Node</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <Dialog open={showShutdownModal} onOpenChange={setShowShutdownModal}>
        <DialogContent className="border-border/50 shadow-none sm:max-w-md rounded-none">
          <DialogTitle className="uppercase tracking-tight">Critical Shutdown</DialogTitle>
          <DialogDescription className="text-xs font-medium italic opacity-60">
            Terminate the 8Router infrastructure core. This will disconnect all active upstream sessions.
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => setShowShutdownModal(false)} className="text-[10px] font-bold uppercase tracking-widest h-9 rounded-none border-border/50 bg-background">
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleShutdown} disabled={isShuttingDown} className="text-[10px] font-bold uppercase tracking-widest h-9 rounded-none border-none bg-destructive/10 text-destructive hover:bg-destructive/20 shadow-none">
               {isShuttingDown ? (
                 <>
                   <Desktop data-icon="inline-start" className="size-3.5 animate-spin mr-1.5" />
                   Terminating...
                 </>
               ) : (
                 "Confirm Shutdown"
               )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isDisconnected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card p-8 rounded-none border border-border/50 text-center max-w-sm mx-4 shadow-2xl flex flex-col gap-6">
            <div className="size-16 rounded-none bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto">
              <Power className="size-10 text-destructive" weight="bold" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight text-foreground uppercase">8Router Offline</h2>
              <p className="text-xs text-muted-foreground font-medium italic opacity-60 leading-relaxed">The infrastructure node has been successfully de-provisioned and halted.</p>
            </div>
            <Button className="w-full font-bold text-[10px] uppercase tracking-widest h-11 rounded-none shadow-none" onClick={() => globalThis.location.reload()}>
              Reconnect Gateway
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
