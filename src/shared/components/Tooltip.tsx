"use client";

import * as React from "react";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TooltipProps {
  text: string;
  children: React.ReactElement; // Base UI TooltipTrigger render prop expects a single element
  position?: "top" | "bottom" | "left" | "right";
}

export default function Tooltip({ text, children, position = "top" }: TooltipProps) {
  if (!text) return children;

  return (
    <ShadcnTooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={position} className="bg-muted-foreground text-background border-none text-[10px] px-2 py-1 font-bold uppercase tracking-widest rounded-none shadow-none">
        <p>{text}</p>
      </TooltipContent>
    </ShadcnTooltip>
  );
}
