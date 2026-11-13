"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
  variant = "default",
  ariaLabel,
  asTabs = false,
}) {
  const panel = variant === "panel";
  const sizes = {
    sm: "h-7 text-xs",
    md: "h-9 text-sm",
    lg: "h-11 text-base",
  };

  return (
    <div
      role={asTabs ? "tablist" : "group"}
      aria-label={ariaLabel}
      className={cn(
        panel ? "flex rounded-lg border border-border/60 bg-surface p-0.5" : "inline-flex items-center p-1 rounded-[10px] overflow-x-auto bg-surface-2",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role={asTabs ? "tab" : undefined}
          id={option.id}
          aria-controls={option.controls}
          aria-selected={asTabs ? value === option.value : undefined}
          aria-pressed={asTabs ? undefined : value === option.value}
          aria-label={option.ariaLabel}
          tabIndex={asTabs ? value === option.value ? 0 : -1 : undefined}
          onClick={() => onChange(option.value)}
          onKeyDown={asTabs ? event => {
            const index = options.findIndex(item => item.value === option.value);
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
              : event.key === "ArrowRight" ? (index + 1) % options.length
                : event.key === "ArrowLeft" ? (index - 1 + options.length) % options.length : null;
            if (next === null) return;
            event.preventDefault();
            onChange(options[next].value);
            event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
          } : undefined}
          className={cn(
            panel ? "flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : "shrink-0 px-4 rounded-[8px] font-medium transition-all",
            panel && (size === "sm" ? "px-1.5 text-[11px]" : "px-2 text-xs"),
            !panel && sizes[size],
            value === option.value
              ? panel ? "bg-primary/12 text-primary shadow-xs" : "bg-surface text-text-main shadow-sm"
              : panel ? "text-text-muted hover:bg-black/5 hover:text-text-main dark:hover:bg-white/5" : "text-text-muted hover:text-text-main"
          )}
        >
          {option.icon && (
            <span aria-hidden="true" className={cn("material-symbols-outlined", panel ? "text-[15px]" : "text-[16px] mr-1.5")}>
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
