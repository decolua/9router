"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
  icon?: string | React.ReactNode;
}

interface SegmentedControlProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}: SegmentedControlProps) {
  return (
    <Tabs value={value} onValueChange={onChange} className={className}>
      <TabsList className={cn(
        "bg-muted/50 p-1 rounded-none border border-border/50 shadow-none h-auto",
        size === "sm" && "h-8",
        size === "md" && "h-10",
        size === "lg" && "h-12"
      )}>
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className={cn(
              "font-bold uppercase tracking-widest transition-all rounded-none data-[state=active]:shadow-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary",
              size === "sm" && "text-[9px] px-2 py-1",
              size === "md" && "text-[10px] px-4 py-1.5",
              size === "lg" && "text-xs px-6 py-2"
            )}
          >
            {option.icon && (
              typeof option.icon === "string" ? (
                <span className="material-symbols-outlined text-[16px] mr-1.5" data-icon="inline-start">
                  {option.icon}
                </span>
              ) : (
                <span className="mr-1.5" data-icon="inline-start">{option.icon}</span>
              )
            )}
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
