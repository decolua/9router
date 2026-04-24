"use client";

import React, { useState, useEffect } from "react";
import { HourglassLow } from "@phosphor-icons/react";

interface CooldownTimerProps {
  until: string;
}

export default function CooldownTimer({ until }: CooldownTimerProps) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const updateRemaining = () => {
      const diff = new Date(until).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("");
        return;
      }
      const secs = Math.floor(diff / 1000);
      if (secs < 60) {
        setRemaining(`${secs}s`);
      } else if (secs < 3600) {
        setRemaining(`${Math.floor(secs / 60)}m ${secs % 60}s`);
      } else {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        setRemaining(`${hrs}h ${mins}m`);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [until]);

  if (!remaining) return null;

  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-bold tabular-nums uppercase tracking-tight bg-muted/40 px-1 py-0.5 rounded-none border border-border/40">
      <HourglassLow className="size-3" weight="bold" />
      {remaining}
    </span>
  );
}
