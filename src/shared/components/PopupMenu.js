"use client";

// Portal-anchored popup menu. Renders at document.body so it can never be
// clipped by overflow-x-auto/overflow-hidden ancestors (tables, cards).
// Handles flip-on-edge, reposition on scroll/resize, outside click + Escape.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/utils/cn";

export default function PopupMenu({
  open,
  onClose,
  triggerRef, // Ref to the anchor element
  children, // ReactNode, or function(query) when searchable
  searchable = false,
  searchPlaceholder = "搜索",
  onQueryChange, // optional external query listener
  minWidth = 180,
  className,
}) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null); // { top, left } fixed coords

  const updatePosition = useCallback(() => {
    const anchor = triggerRef?.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panel = panelRef.current;
    const width = Math.max(minWidth, panel ? panel.offsetWidth : 0);
    const height = panel ? panel.offsetHeight : 240;
    let left = Math.min(Math.max(4, rect.left), window.innerWidth - width - 4);
    // Flip above if it would overflow the bottom (and there's room above).
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8 && rect.top - height - 8 > 0) {
      top = Math.max(4, rect.top - height - 4);
    }
    setPos({ top, left });
  }, [triggerRef, minWidth]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    // Reposition on scroll/resize — capture phase catches table/container scrolls.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
      }
    };
    const onMouseDown = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, onClose, triggerRef]);

  // Search query lives here while open; resets by unmount when closed.
  // (setState-in-effect lint avoided: no effect touches state directly.)
  const [query, setQuery] = useState("");

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth }}
      className={cn("z-[70] max-w-[92vw] rounded-md border border-border bg-surface shadow-xl slide-in-top", className)}
    >
      {searchable && (
        <PopupMenuSearch
          searchPlaceholder={searchPlaceholder}
          onQueryChange={(q) => {
            setQuery(q);
            onQueryChange?.(q);
          }}
        />
      )}
      {/* Children receive the trimmed lowercase query when searchable. */}
      {typeof children === "function" ? children(query) : children}
    </div>,
    document.body
  );
}

// Search box; focus on mount (only mounted while open) and delegate filtering.
function PopupMenuSearch({ searchPlaceholder, onQueryChange }) {
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="border-b border-border p-2">
      <input
        ref={inputRef}
        autoFocus
        onChange={(event) => onQueryChange(event.target.value.trim().toLowerCase())}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="h-8 w-full rounded-md border border-border bg-bg-base px-2 text-sm outline-none focus:border-primary"
      />
    </div>
  );
}

// Shared option row used inside PopupMenu panels.
export function PopupMenuItem({ active, disabled, onClick, children, className }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onClick?.()}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-primary/10 text-primary",
        className
      )}
    >
      {children}
      {active && <span className="material-symbols-outlined shrink-0 text-[16px]">check</span>}
    </button>
  );
}
