"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  BarChart3, 
  ChevronRight, 
  Database, 
  Globe, 
  Layers, 
  Monitor, 
  Power, 
  Search, 
  Settings, 
  ShieldCheck, 
  Terminal, 
  Zap,
  Command,
  AlertTriangle,
  MoreHorizontal,
  AudioLines
} from "lucide-react";

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
  DropdownMenuLabel,
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

const VISIBLE_MEDIA_KINDS = ["embedding", "tts"];

export default function AppSidebar({ ...props }) {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const [showShutdownModal, setShowShutdownModal] = React.useState(false);
  const [isShuttingDown, setIsShuttingDown] = React.useState(false);
  const [isDisconnected, setIsDisconnected] = React.useState(false);
  const [enableTranslator, setEnableTranslator] = React.useState(false);

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

  const isActive = (url) => {
    if (url === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(url);
  };

  const navData = React.useMemo(() => ({
    user: { name: "System Admin", email: "admin@8router.ai", avatar: "/favicon.svg" },
    teams: [{ name: "8Router Proxy", logo: Command, plan: `v${APP_CONFIG.version}` }],
    navMain: [
      { title: "Dịch vụ chính", items: [{ title: "Endpoint", url: "/dashboard/endpoint", icon: Zap, badge: "API" }, { title: "Nhà cung cấp", url: "/dashboard/providers", icon: Database }, { title: "Kết hợp", url: "/dashboard/combos", icon: Layers }] },
      { title: "Giám sát", items: [{ title: "Thống kê", url: "/dashboard/usage", icon: BarChart3 }, { title: "Quota", url: "/dashboard/quota", icon: Search }] },
      { title: "Phát triển", items: [{ title: "MITM Proxy", url: "/dashboard/mitm", icon: ShieldCheck }, { title: "Công cụ", url: "/dashboard/cli-tools", icon: Terminal }] },
    ],
    system: [{ title: "Proxy Pools", url: "/dashboard/proxy-pools", icon: Globe }, { title: "Nhật ký Console", url: "/dashboard/console-log", icon: Monitor }, ...(enableTranslator ? [{ title: "Translator", url: "/dashboard/translator", icon: Globe }] : [])]
  }), [enableTranslator]);

  return (
    <>
      <Sidebar collapsible="icon" {...props} className="border-r border-border/50">
        <SidebarHeader className="border-b border-border/50 pb-4">
          <SidebarMenu>
            <SidebarMenuItem>
              {(() => {
                const TeamLogo = navData.teams[0].logo;
                return (
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground mt-2 rounded-xl transition-all hover:bg-sidebar-accent/50" render={<Link href="/dashboard" />}>
                    <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md ring-1 ring-primary/20">
                      <TeamLogo className="size-5" />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight ml-1">
                      <span className="truncate font-bold tracking-tight text-base">{navData.teams[0].name}</span>
                      <span className="truncate text-[11px] font-medium text-muted-foreground">{navData.teams[0].plan}</span>
                    </div>
                  </SidebarMenuButton>
                );
              })()}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="gap-2 px-2 py-4">
          {navData.navMain.map((group) => (
            <SidebarGroup key={group.title} className="px-0">
              <SidebarGroupLabel className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-1 px-2">{group.title}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton isActive={isActive(item.url)} tooltip={item.title} render={<Link href={item.url} />} className="rounded-lg transition-colors h-9">
                      <item.icon className="size-4 opacity-70" />
                      <span className="font-medium text-sm">{item.title}</span>
                    </SidebarMenuButton>
                    {item.badge && <SidebarMenuBadge className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-primary/10 text-primary hover:bg-primary/20">{item.badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}

          <SidebarGroup className="px-0">
            <SidebarGroupLabel className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-1 px-2">Hệ thống</SidebarGroupLabel>
            <SidebarMenu>
              <Collapsible defaultOpen={pathname.includes("media-providers")} className="group/collapsible">
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Media Providers" render={<CollapsibleTrigger />} className="rounded-lg h-9">
                    <AudioLines className="size-4 opacity-70" />
                    <span className="font-medium text-sm">Media Providers</span>
                    <ChevronRight className="ml-auto size-4 opacity-50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                  <CollapsibleContent className="animate-in fade-in-50 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
                    <SidebarMenuSub className="mr-0 pr-0 border-l-border/50">
                      {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                        <SidebarMenuSubItem key={kind.id}>
                          <SidebarMenuSubButton isActive={pathname.includes(kind.id)} render={<Link href={`/dashboard/media-providers/${kind.id}`} />} className="rounded-md h-8 text-sm">
                            <span className="font-medium">{kind.label}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {navData.system.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton isActive={isActive(item.url)} tooltip={item.title} render={<Link href={item.url} />} className="rounded-lg transition-colors h-9">
                    <item.icon className="size-4 opacity-70" />
                    <span className="font-medium text-sm">{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-border/50 p-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground rounded-xl transition-all hover:bg-sidebar-accent/50"
                  >
                    <Avatar className="h-9 w-9 rounded-lg shadow-sm ring-1 ring-border/50">
                      <AvatarImage src={navData.user.avatar} alt={navData.user.name} />
                      <AvatarFallback className="rounded-lg bg-primary/10 text-primary font-bold">SA</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight ml-1">
                      <span className="truncate font-bold">{navData.user.name}</span>
                      <span className="truncate text-xs font-medium text-muted-foreground">{navData.user.email}</span>
                    </div>
                    <MoreHorizontal className="ml-auto size-4 text-muted-foreground" />
                  </SidebarMenuButton>
                } />
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl shadow-lg border border-border/50 pb-1"
                  side={isMobile ? "bottom" : "right"}
                  align="end"
                  sideOffset={4}
                >
                  <div className="p-0 font-normal">
                    <div className="flex items-center gap-3 px-2 py-3 text-left text-sm bg-muted/30 rounded-t-xl mb-1">
                      <Avatar className="h-10 w-10 rounded-lg shadow-sm ring-1 ring-border/50">
                        <AvatarImage src={navData.user.avatar} alt={navData.user.name} />
                        <AvatarFallback className="rounded-lg bg-primary/10 text-primary font-bold">SA</AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-bold text-base">{navData.user.name}</span>
                        <span className="truncate text-xs font-medium text-muted-foreground">{navData.user.email}</span>
                      </div>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup className="px-1">
                    <DropdownMenuItem render={
                      <Link href="/dashboard/profile" className="flex items-center">
                        <Settings className="mr-2 size-4 opacity-70" />
                        <span className="font-medium">Cài đặt hệ thống</span>
                      </Link>
                    } className="rounded-md cursor-pointer h-9" />
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <div className="px-1 mt-1">
                    <DropdownMenuItem onClick={() => setShowShutdownModal(true)} className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer rounded-md h-9">
                      <Power className="mr-2 size-4" />
                      <span className="font-bold">Shutdown Server</span>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <Dialog open={showShutdownModal} onOpenChange={setShowShutdownModal}>
        <DialogContent className="sm:max-w-md rounded-2xl p-0 gap-0 overflow-hidden border-border/50 shadow-2xl">
          <div className="bg-destructive/10 px-6 py-8 flex flex-col items-center justify-center text-center">
             <div className="size-16 rounded-full bg-destructive/20 text-destructive flex items-center justify-center mb-4 shadow-sm ring-4 ring-destructive/5">
                <AlertTriangle className="size-8 animate-pulse" />
             </div>
             <DialogTitle className="text-xl font-bold text-foreground">Critical Shutdown</DialogTitle>
             <DialogDescription className="text-muted-foreground mt-2 max-w-[280px]">
               Stop the 8Router proxy core. This will immediately disconnect all active upstream sessions.
             </DialogDescription>
          </div>
          <div className="p-4 bg-background flex justify-between items-center px-6">
            <Button variant="ghost" className="font-semibold text-sm rounded-xl px-6" onClick={() => setShowShutdownModal(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="font-semibold text-sm px-6 rounded-xl shadow-sm" onClick={handleShutdown} disabled={isShuttingDown}>
               {isShuttingDown ? (
                 <span className="flex items-center gap-2">
                   <Monitor className="size-4 animate-spin" />
                   Terminating...
                 </span>
               ) : (
                 "Confirm Shutdown"
               )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isDisconnected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-card p-8 rounded-3xl border border-border/50 shadow-2xl text-center max-w-sm mx-4 animate-in zoom-in-95 duration-500">
            <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-6 ring-8 ring-destructive/5">
              <Power className="size-8" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-2">8Router Offline</h2>
            <p className="text-sm text-muted-foreground mb-8">The infrastructure node has been successfully de-provisioned and halted.</p>
            <Button className="w-full font-bold text-sm uppercase tracking-widest h-12 rounded-xl shadow-md transition-all hover:scale-[1.02]" onClick={() => globalThis.location.reload()}>
              Reconnect Gateway
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
