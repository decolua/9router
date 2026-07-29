"use client";

import { useEffect } from "react";

/** Reveal Material Symbols icons once the icon font has loaded (avoids ligature text flash). */
export function FontsLoadedMarker() {
  useEffect(() => {
    const mark = () => document.documentElement.classList.add("fonts-loaded");
    if (document.fonts?.ready) {
      document.fonts.ready.then(mark);
    } else {
      mark();
    }
  }, []);
  return null;
}
