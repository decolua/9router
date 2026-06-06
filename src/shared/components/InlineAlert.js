"use client";

import Link from "next/link";
import { cn } from "@/shared/utils/cn";

const VARIANTS = {
  warning: {
    wrapper: "bg-warning/10 border-warning/30 text-warning",
    icon: "warning",
    iconClass: "text-warning",
  },
  info: {
    wrapper: "bg-info/10 border-info/30 text-info",
    icon: "info",
    iconClass: "text-info",
  },
  danger: {
    wrapper: "bg-danger/10 border-danger/30 text-danger",
    icon: "error",
    iconClass: "text-danger",
  },
  caution: {
    wrapper: "bg-warning/10 border-warning/30 text-warning",
    icon: "warning",
    iconClass: "text-warning",
  },
};

/**
 * Unified inline alert banner (warning, info, danger, caution).
 */
export default function InlineAlert({
  variant = "warning",
  title,
  message,
  children,
  action,
  className,
  compact = false,
}) {
  const styles = VARIANTS[variant] || VARIANTS.warning;
  const isAnchor = action?.href?.startsWith("#");

  return (
    <div
      className={cn(
        "flex items-start gap-2 border rounded-brand",
        compact ? "px-3 py-2" : "px-3 py-2.5",
        styles.wrapper,
        className
      )}
    >
      <span className={cn("material-symbols-outlined text-[16px] shrink-0 mt-0.5", styles.iconClass)}>
        {styles.icon}
      </span>
      <div className="flex-1 min-w-0">
        {title ? <p className={cn("font-medium", compact ? "text-xs" : "text-sm")}>{title}</p> : null}
        {message ? (
          <p className={cn("leading-relaxed", compact ? "text-xs" : "text-xs sm:text-sm", title && "mt-0.5")}>
            {message}
          </p>
        ) : null}
        {children}
      </div>
      {action ? (
        isAnchor ? (
          <a
            href={action.href}
            className="text-xs font-medium underline shrink-0 hover:opacity-80 mt-0.5"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {action.label}
          </a>
        ) : (
          <Link href={action.href} className="text-xs font-medium underline shrink-0 hover:opacity-80 mt-0.5">
            {action.label}
          </Link>
        )
      ) : null}
    </div>
  );
}
