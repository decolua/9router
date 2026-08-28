"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/shared/utils/cn";

// Multi-select dropdown. value is an array of option values; "all" means every
// option is selected (sentinel rendered as a "All X" chip). Toggling the last
// selected option drops back to "all" so the user can always return to
// selecting everything — mirroring the summary-card default.
export default function MultiSelect({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = "All",
  className,
  allLabel,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const optionSet = new Set(options.map((o) => o.value));
  const selected = (value || []).filter((v) => optionSet.has(v));
  const allSelected = selected.length === options.length && options.length > 0;

  const toggle = (v) => {
    let next;
    if (selected.includes(v)) {
      // Removing the last one collapses back to "all".
      next = selected.length <= 1 ? [] : selected.filter((x) => x !== v);
    } else {
      next = [...selected, v];
      if (next.length === options.length) next = []; // reaching all → treat as all
    }
    onChange(next);
  };

  const summary = allSelected || selected.length === 0
    ? (allLabel || `All ${label || ""}`.trim())
    : `${selected.length} selected`;

  return (
    <div className={cn("relative flex flex-col gap-1.5", className)} ref={ref}>
      {label && (
        <span className="text-sm font-medium text-text-main">{label}</span>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full h-10 px-3 flex items-center justify-between gap-2 text-sm",
          "bg-surface-2 border border-transparent rounded-[10px]",
          "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
          "transition-all duration-150 cursor-pointer hover:border-border",
          open && "ring-2 ring-brand-500/30 border-brand-500/40"
        )}
      >
        <span className={cn(selected.length === 0 || allSelected ? "text-text-muted" : "text-text-main")}>
          {summary}
        </span>
        <span className="material-symbols-outlined text-[20px] text-text-muted">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-30 mt-1 rounded-[10px] border border-border bg-surface shadow-lg max-h-64 overflow-auto py-1">
          <button
            type="button"
            onClick={() => { onChange([]); }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-2/60 cursor-pointer",
              allSelected ? "text-text-main" : "text-text-muted"
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded border",
                allSelected ? "bg-brand-500 border-brand-500 text-white" : "border-border"
              )}
            >
              {allSelected && <span className="material-symbols-outlined text-[13px]">check</span>}
            </span>
            {allLabel || "Select all"}
          </button>
          {options.map((o) => {
            const isSel = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-text-main hover:bg-surface-2/60 cursor-pointer"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border",
                    isSel ? "bg-brand-500 border-brand-500 text-white" : "border-border"
                  )}
                >
                  {isSel && <span className="material-symbols-outlined text-[13px]">check</span>}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
