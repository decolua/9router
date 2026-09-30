"use client";

import { useState, useEffect } from "react";

/**
 * Live clock that ticks every second. Pauses while the tab is hidden
 * and re-syncs on visibility change so the countdown stays accurate
 * without burning CPU in the background.
 * @param {boolean} active
 * @returns {number} Date.now() updated once per second while active
 */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.hidden) return;
      setNow(Date.now());
    };
    tick();
    const id = setInterval(tick, 1000);
    const onVisible = () => {
      if (!document.hidden) setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  return now;
}
