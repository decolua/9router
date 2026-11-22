"use client";

import { cn } from "@/shared/utils/cn";

// Elevation is a three-tier ladder defined in the chrome contract
// (src/shared/styles/chrome.css): 1 = resting surface, 2 = raised, 3 = floating
// overlay. A Card only ever sits at 1, or at 2 when it is genuinely raised
// (`elev`) -- never a hand-picked shadow per page.
const PADDINGS = {
  none: "",
  xs: "p-3",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}) {
  return (
    <div
      data-neo-card="true"
      className={cn(
        "neo-panel flex min-w-0 flex-col bg-surface border-2 border-text-main",
        "rounded-[var(--r-card)]",
        elev ? "shadow-[var(--elev-2)]" : "shadow-[var(--elev-1)]",
        // The lift (and the pointer cursor) is opt-in and means exactly one
        // thing: this card does something when clicked. A read-only card never
        // moves, so the motion stays a signal instead of decoration.
        hover && "chrome-interactive cursor-pointer",
        PADDINGS[padding] ?? PADDINGS.md,
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-4 flex min-h-12 items-center justify-between gap-3 border-b-2 border-text-main pb-3">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="flex size-9 shrink-0 items-center justify-center border-2 border-text-main bg-surface-2 shadow-[2px_2px_0_var(--neo-ink)]">
                <span className="material-symbols-outlined text-[20px] text-primary">{icon}</span>
              </div>
            )}
            <div>
              {title && (
                <h3 className="text-text-main font-semibold tracking-tight">{title}</h3>
              )}
              {subtitle && (
                <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "neo-inset p-4 rounded-[var(--r-control)]",
        "bg-bg/80 border border-border-subtle",
        // The same 1px top hairline every elevation tier carries, so an inset
        // section reads as part of the lit-from-above system instead of as a
        // flat box drawn inside another box.
        "shadow-[inset_0_1px_0_0_var(--edge-highlight)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-3 -mx-3 px-3",
        "border-b border-border-subtle last:border-b-0",
        "chrome-row",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 p-3 -mx-3 px-3",
        "border-b border-border-subtle last:border-b-0",
        "chrome-row",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
};
