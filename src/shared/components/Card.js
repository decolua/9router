"use client";

import { cn } from "@/shared/utils/cn";

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
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      className={cn(
        "bg-surface border border-border-subtle",
        "rounded-[14px] shadow-[var(--shadow-soft)]",
        elev && "shadow-[var(--shadow-elev)]",
        hover &&
          "hover:shadow-[var(--shadow-warm)] hover:border-brand-500/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer",
        !hover && "transition-colors",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-[10px] bg-brand-500/10 border border-brand-500/20">
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
        "p-4 rounded-[10px]",
        "bg-bg/80 border border-border-subtle",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
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
        "p-3 -mx-3 px-3 transition-colors",
        "border-b border-border-subtle last:border-b-0",
        "hover:bg-surface-2/50",
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
        "hover:bg-surface-2/50 transition-colors",
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
