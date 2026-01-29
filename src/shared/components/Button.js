"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-warm",
  secondary: "bg-surface border border-border text-text-main hover:bg-black/5 shadow-sm",
  outline: "border border-border text-text-main hover:bg-black/5",
  ghost: "text-text-muted hover:bg-black/5 hover:text-text-main",
  danger: "bg-red-500 text-white hover:bg-red-600 shadow-sm",
};

const sizes = {
  sm: "h-8 px-3 text-xs rounded-md",
  md: "h-10 px-5 text-sm rounded-lg",
  lg: "h-12 px-8 text-base rounded-xl",
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
        "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 cursor-pointer",
        "active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && <span className="material-symbols-outlined text-[18px]">{iconRight}</span>}
    </button>
  );
}
