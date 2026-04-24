"use client";

import React, { useState } from "react";
import NineRemotePromoModal from "./NineRemotePromoModal";
import { Monitor } from "@phosphor-icons/react";

export default function NineRemoteButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all text-muted-foreground hover:text-foreground hover:bg-muted/50 group"
        title="9Remote Access"
      >
        <Monitor className="size-[18px] group-hover:scale-110 transition-transform" weight="bold" />
        <span className="text-xs font-bold uppercase tracking-widest">Remote</span>
      </button>

      <NineRemotePromoModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
