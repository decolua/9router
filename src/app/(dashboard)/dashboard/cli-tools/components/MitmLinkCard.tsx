"use client";

import React from "react";
import Link from "next/link";
import { Card, Badge } from "@/shared/components";
import { CaretRight as ChevronRight, Shield } from "@phosphor-icons/react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface Tool {
  id: string;
  name: string;
  description: string;
  image?: string;
}

interface MitmLinkCardProps {
  tool: Tool;
}

/**
 * Clickable card for MITM tools — navigates to /dashboard/mitm on click.
 */
export default function MitmLinkCard({ tool }: MitmLinkCardProps) {
 return (
 <Link href="/dashboard/mitm" className="block group">
 <Card className="overflow-hidden border-border/50 hover:bg-muted/5 transition-all duration-300 rounded-none shadow-none">
 <div className="flex items-center justify-between p-4 cursor-pointer select-none">
 <div className="flex items-center gap-4">
 <div className="relative size-10 flex-shrink-0 bg-background rounded-none border border-border/50 p-1.5 flex items-center justify-center">
 {tool.image ? (
 <Image
 src={tool.image}
 alt={tool.name}
 width={28}
 height={28}
 className="object-contain"
 />
 ) : (
 <Shield className="text-muted-foreground size-5" weight="bold" />
 )}
 </div>
 <div className="space-y-0.5">
 <div className="flex items-center gap-2">
 <h3 className="font-bold text-sm tracking-tight text-foreground">{tool.name}</h3>
 <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-bold uppercase bg-primary/10 text-primary border-none rounded-none tracking-widest">MITM</Badge>
 </div>
 <p className="text-xs text-muted-foreground font-medium line-clamp-1 max-w-md italic">{tool.description}</p>
 </div>
 </div>
 <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" weight="bold" />
 </div>
 </Card>
 </Link>
 );
}
