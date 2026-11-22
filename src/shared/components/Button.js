"use client";

import { cn } from "@/shared/utils/cn";
import { Spinner } from "@/shared/components/Loading";

const variants = {
  primary:
    "bg-brand-500 hover:bg-brand-400 text-[#13120f] border-brand-500 disabled:bg-surface-3 disabled:border-border-subtle disabled:text-text-muted disabled:shadow-none",
  secondary:
    "bg-surface-2 hover:bg-surface-3 text-text-main border-text-main hover:border-brand-500 disabled:opacity-50",
  outline:
    "border-text-main bg-transparent text-text-main hover:bg-surface-2 hover:border-brand-500",
  // Opt-in white action; neobrutalist outlines and offset shadows come from the theme layer.
  white:
    "bg-white text-neutral-900 border-neutral-900 hover:bg-neutral-100 disabled:shadow-none",
  ghost: "border-transparent bg-transparent text-text-muted hover:bg-surface-2 hover:text-text-main shadow-none",
  danger:
    "bg-danger hover:bg-red-600 text-[#13120f] border-text-main disabled:bg-surface-3 disabled:text-text-muted",
  success:
    "bg-success hover:bg-green-400 text-[#13120f] border-text-main disabled:bg-surface-3 disabled:text-text-muted",
};

const sizes = {
  xs: "h-6 px-2.5 text-[11px] rounded-[6px] gap-1.5",
  sm: "h-7 px-3 text-xs rounded-[8px]",
  md: "h-9 px-4 text-sm rounded-[10px]",
  lg: "h-11 px-6 text-sm rounded-[10px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "neo-button inline-flex items-center justify-center gap-2 font-semibold cursor-pointer border-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Spinner size="sm" className="shrink-0 text-current" decorative />
      ) : icon ? (
        <span className={cn("material-symbols-outlined", size === "xs" ? "text-[14px]" : "text-[18px]")}>{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className={cn("material-symbols-outlined", size === "xs" ? "text-[14px]" : "text-[18px]")}>{iconRight}</span>
      )}
    </button>
  );
}
