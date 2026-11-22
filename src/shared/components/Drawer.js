"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import { lockBodyScroll, unlockBodyScroll } from "@/shared/utils/scrollLock";

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className,
}) {
  const widths = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  // Same reference-counted lock as Modal: a Drawer opened from a page that
  // already has a Modal up must not release the page scroll when it closes.
  useEffect(() => {
    if (!isOpen) return undefined;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        className="absolute inset-0  chrome-enter-overlay cursor-pointer"
        style={{ backgroundColor: "var(--color-scrim)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "absolute right-0 top-0 h-full max-w-[calc(100vw-2.5rem)] bg-surface flex flex-col",
          "shadow-[var(--elev-3)]",
          "chrome-enter-drawer",
          // A drawer is flush with the right viewport edge, so it only rounds
          // the two corners that are actually visible.
          "rounded-l-[var(--r-card-lg)]",
          "border-l border-border-subtle",
          widths[width] || widths.md,
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-[var(--pad-surface)] py-[var(--pad-surface-sm)] border-b border-border-subtle min-h-[var(--h-header)] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {title && (
              <h2 className="text-lg font-semibold text-text-main truncate">{title}</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="chrome-focus p-1.5 rounded-[var(--r-control)] text-text-muted chrome-row hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[20px]">cancel</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-[var(--pad-surface)] custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
