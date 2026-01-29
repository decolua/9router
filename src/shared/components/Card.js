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
  className,
  ...props
}) {
  const paddings = {
    none: "",
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  return (
    <div
      className={cn(
        "bg-surface",
        "border border-border",
        "rounded-xl shadow-soft",
        hover && "hover:shadow-warm hover:border-primary/30 transition-all cursor-pointer",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-lg bg-bg text-text-muted">
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
              </div>
            )}
            <div>
              {title && <h3 className="text-text-main font-semibold">{title}</h3>}
              {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// Sub-component: Bordered section inside Card
Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div className={cn("p-4 rounded-lg", "bg-surface", "border border-border", className)} {...props}>
      {children}
    </div>
  );
};

// Sub-component: Hoverable row inside Card
Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-3 -mx-3 px-3 border-b border-border last:border-b-0 transition-colors",
        "hover:bg-sidebar",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
