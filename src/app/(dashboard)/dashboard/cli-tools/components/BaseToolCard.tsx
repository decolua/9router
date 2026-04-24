"use client";

import React from "react";
import { 
 Card, 
 CardContent, 
 Badge, 
 Button 
} from "@/shared/components";
import { 
 CaretDown as ChevronDown, 
 CaretUp as ChevronUp, 
 Gear as Settings, 
 ArrowsClockwise as RotateCcw, 
 ArrowSquareOut as ExternalLink, 
 Question as HelpCircle,
 WarningCircle as AlertCircle,
 CheckCircle as CheckCircle2,
 Clock,
 Terminal
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

const ICON_MAP: Record<string, any> = {
 terminal: Terminal,
 settings: Settings,
 help: HelpCircle,
};

interface Tool {
  id: string;
  name: string;
  description: string;
  image?: string;
  icon?: string | any;
}

interface BaseToolCardProps {
  tool: Tool;
  isExpanded: boolean;
  onToggle: () => void;
  status: "configured" | "not_configured" | "other" | "error" | null;
  checking?: boolean;
  applying?: boolean;
  restoring?: boolean;
  message?: { type: "success" | "error"; text: string } | null;
  onApply?: (() => void) | null;
  onReset?: (() => void) | null;
  onShowManualConfig?: (() => void) | null;
  onCheckStatus?: (() => void) | null;
  hasActiveProviders?: boolean;
  children: React.ReactNode;
}

/**
 * BaseToolCard - Core component for CLI tools dashboard
 */
export default function BaseToolCard({
 tool,
 isExpanded,
 onToggle,
 status,
 checking = false,
 applying = false,
 restoring = false,
 message = null,
 onApply,
 onReset,
 onShowManualConfig,
 onCheckStatus,
 hasActiveProviders = true,
 children
}: BaseToolCardProps) {
 const IconComponent = typeof tool.icon === 'string' ? (ICON_MAP[tool.icon] || Settings) : (tool.icon || Settings);
 
 const renderStatusBadge = () => {
 if (checking) {
 return (
 <Badge variant="outline" className="flex items-center gap-1.5 bg-muted/30 border-none h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider">
 <Clock className="size-3 animate-pulse" weight="bold" />
 <span>{translate("Checking...")}</span>
 </Badge>
 );
 }

 switch (status) {
 case "configured":
 return (
 <Badge variant="outline" className="flex items-center gap-1.5 border-none bg-primary/10 text-primary dark:text-primary h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider">
 <CheckCircle2 className="size-3" weight="bold" />
 <span>{translate("Configured")}</span>
 </Badge>
 );
 case "not_configured":
 return (
 <Badge variant="outline" className="flex items-center gap-1.5 border-none bg-muted/30 text-muted-foreground dark:text-muted-foreground h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider">
 <HelpCircle className="size-3" weight="bold" />
 <span>{translate("Unconfigured")}</span>
 </Badge>
 );
 case "other":
 return (
 <Badge variant="outline" className="flex items-center gap-1.5 border-none bg-primary/10 text-primary dark:text-primary h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider">
 <Settings className="size-3" weight="bold" />
 <span>{translate("Custom Config")}</span>
 </Badge>
 );
 case "error":
 return (
 <Badge variant="outline" className="flex items-center gap-1.5 border-none bg-destructive/5 text-destructive h-5 px-1.5 text-[10px] font-bold uppercase tracking-wider">
 <AlertCircle className="size-3" weight="bold" />
 <span>{translate("Error")}</span>
 </Badge>
 );
 default:
 return null;
 }
 };

 return (
 <Card className={cn(
 "overflow-hidden transition-all duration-300 border-border/50 rounded-none shadow-none",
 isExpanded ? "bg-muted/5" : "hover:bg-muted/5"
 )}>
 {/* Header */}
 <div 
 className={cn(
 "flex items-center justify-between p-4 cursor-pointer select-none transition-colors",
 isExpanded && "border-b border-border/40 bg-muted/10"
 )}
 onClick={onToggle}
 >
 <div className="flex items-center gap-4 min-w-0">
 <div className="relative size-10 flex-shrink-0 bg-background rounded-none border border-border/50 p-1.5 flex items-center justify-center shadow-none">
 {tool.image ? (
 <img src={tool.image} alt={tool.name} width={28} height={28} className="object-contain" />
 ) : (
 <IconComponent className="text-muted-foreground size-5" weight="bold" />
 )}
 </div>
 <div className="space-y-0.5 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <h3 className="font-bold text-sm tracking-tight text-foreground uppercase">{tool.name}</h3>
 {renderStatusBadge()}
 </div>
 <p className="text-xs text-muted-foreground font-medium truncate max-w-md italic">{tool.description}</p>
 </div>
 </div>

 <div className="flex items-center gap-3 shrink-0">
 {onCheckStatus && !isExpanded && (
 <Button 
 variant="ghost"
 size="icon"
 onClick={(e) => { e.stopPropagation(); onCheckStatus(); }}
 disabled={checking}
 className="size-7 rounded-full text-muted-foreground hover:text-foreground"
 title="Refresh status"
 >
 <RotateCcw className={cn("size-3.5", checking && "animate-spin")} weight="bold" />
 </Button>
 )}
 {isExpanded ? <ChevronUp className="size-4 text-muted-foreground" weight="bold" /> : <ChevronDown className="size-4 text-muted-foreground" weight="bold" />}
 </div>
 </div>

 {/* Content */}
 {isExpanded && (
 <CardContent className="p-6 pt-5 space-y-6">
 {/* Custom Configuration UI */}
 <div className="space-y-6">
 {children}
 </div>

 {/* Notification Message */}
 {message && (
 <div className={cn(
 "flex items-center gap-2 px-3 py-2 rounded-none text-[10px] font-bold uppercase tracking-widest animate-in fade-in slide-in-from-top-1",
 message.type === "success" ? "bg-primary/10 text-primary dark:text-primary" : "bg-destructive/10 text-destructive"
 )}>
 {message.type === "success" ? <CheckCircle2 className="size-3.5" weight="bold" /> : <AlertCircle className="size-3.5" weight="bold" />}
 <span>{message.text}</span>
 </div>
 )}

 {/* Action Footer */}
 <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border/40">
 <div className="flex items-center gap-2">
 {onApply && (
 <Button 
 size="sm"
 onClick={onApply} 
 disabled={applying || !hasActiveProviders} 
 className="font-bold text-[10px] uppercase tracking-widest min-w-[100px] h-8 rounded-none shadow-none"
 >
 {applying ? translate("Applying...") : translate("Apply")}
 </Button>
 )}
 {onReset && (
 <Button 
 variant="outline"
 size="sm"
 onClick={onReset} 
 disabled={restoring || status === "not_configured"} 
 className="font-bold text-[10px] uppercase tracking-widest h-8 rounded-none border-border/50"
 >
 <RotateCcw className="mr-1.5 size-3" weight="bold" />
 {restoring ? translate("Resetting...") : translate("Reset")}
 </Button>
 )}
 </div>

 {onShowManualConfig && (
 <Button 
 variant="ghost"
 size="sm"
 onClick={onShowManualConfig}
 className="text-muted-foreground hover:text-foreground h-8 text-[10px] font-bold uppercase tracking-widest"
 >
 <ExternalLink className="mr-1.5 size-3.5" weight="bold" />
 {translate("Manual Config")}
 </Button>
 )}
 </div>
 </CardContent>
 )}
 </Card>
 );
}
