"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showCloseButton = true,
  className,
}) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeOnOverlay ? onClose : undefined}
      />

      {/* Modal content */}
      <div
        className={cn(
          "relative w-full bg-surface",
          "border border-border",
          "rounded-2xl shadow-elevated",
          "animate-in fade-in zoom-in-95 duration-200",
          sizes[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between p-6 border-b border-border">
            {title && (
              <h2 className="text-lg font-semibold text-text-main">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-6 max-h-[calc(80vh-140px)] overflow-y-auto">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Confirm Modal helper
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

