"use client";

import { useState, useCallback, useRef } from "react";

/**
 * Hook for copy to clipboard with feedback
 * @param {number} resetDelay - Time in ms before resetting copied state (default: 2000)
 * @returns {{ copied: string|null, copy: (text: string, id?: string) => void }}
 */
export function useCopyToClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState(null);
  const timeoutRef = useRef(null);

  const copy = useCallback(
    (text, id = "default") => {
      navigator.clipboard.writeText(text);
      setCopied(id);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setCopied(null);
      }, resetDelay);
    },
    [resetDelay]
  );

  return { copied, copy };
}
