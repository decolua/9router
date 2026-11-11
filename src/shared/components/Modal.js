"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";
import Tooltip from "./Tooltip";
import { lockBodyScroll, unlockBodyScroll } from "@/shared/utils/scrollLock";

// Overlay geometry and motion come from the chrome contract
// (src/shared/styles/chrome.css): --r-card-lg for the panel, --elev-3 for the
// floating tier, --pad-surface for the body, --motion-panel for the entrance.
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showTrafficLights = true,
  className,
}) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  // Reference-counted: several pages render a Modal and a ConfirmModal at the
  // same time, and the old code released the lock unconditionally on close, so
  // closing the inner dialog let the page scroll behind the outer one.
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 backdrop-blur-md chrome-enter-overlay"
        style={{ backgroundColor: "var(--color-scrim)" }}
        onClick={closeOnOverlay ? onClose : undefined}
      />

      {/* Modal content */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "relative w-full bg-surface",
          "border border-border-subtle",
          "rounded-[var(--r-card-lg)] shadow-[var(--elev-3)]",
          "chrome-enter-panel",
          // The panel owns the height budget so the body scrolls inside it
          "flex max-h-[92vh] sm:max-h-[85vh] flex-col",
          sizes[size] ?? sizes.md,
          className
        )}
      >
        {/* Header */}
        {(title || showTrafficLights) && (
          <div className="flex items-center justify-between gap-3 px-[var(--pad-surface-sm)] py-3 border-b border-border-subtle min-h-[var(--h-header)]">
            <div className="flex items-center min-w-0 flex-1">
              {/* Traffic lights - desktop only */}
              {showTrafficLights && (
                <div className="hidden md:flex items-center gap-2 mr-4 ml-1 shrink-0">
                  <Tooltip text="Close" position="top" color="#FF5F56">
                    <button
                      onClick={onClose}
                      aria-label="Close"
                      title="Close"
                      className="chrome-focus w-4 h-4 rounded-full bg-[#FF5F56] hover:brightness-90 transition-[filter] duration-[var(--motion-fast)] flex items-center justify-center group/dot"
                    >
                      <span className="material-symbols-outlined text-[11px] font-bold text-white opacity-0 group-hover/dot:opacity-100 transition-opacity leading-none">close</span>
                    </button>
                  </Tooltip>
                  {/* Inert traffic-light decorations; colour comes from .chrome-inert. */}
                  <div className="chrome-inert w-4 h-4 rounded-full" aria-hidden="true" />
                  <div className="chrome-inert w-4 h-4 rounded-full" aria-hidden="true" />
                </div>
              )}
              {title && (
                <h2 className="text-base font-semibold text-text-main truncate min-w-0">{title}</h2>
              )}
            </div>
            {/* X button - mobile only */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="chrome-focus md:hidden shrink-0 p-1 rounded-[var(--r-control)] text-text-muted chrome-row hover:text-text-main"
            >
              <span className="material-symbols-outlined text-[20px] leading-none">close</span>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 pb-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-3 px-[var(--pad-surface)] py-[var(--pad-surface-sm)] border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-text-muted">{message}</p>
    </Modal>
  );
}
