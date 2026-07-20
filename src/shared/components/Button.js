"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-gradient-to-b from-brand-400 to-brand-600 hover:from-brand-500 hover:to-brand-700 hover:shadow-[0_0_15px_rgba(229,106,74,0.3)] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] disabled:bg-none disabled:bg-surface-3 disabled:text-text-muted transition-all duration-300",
  secondary: "bg-surface-2/80 hover:bg-surface-3 text-text-main border border-border/80 backdrop-blur-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)] disabled:opacity-50 transition-all duration-300",
  outline: "border border-border/60 text-text-muted hover:text-text-main hover:bg-surface-2 hover:border-brand-500/25 transition-all duration-300",
  ghost: "text-text-muted hover:bg-surface-2/60 hover:text-text-main transition-all duration-300",
  danger: "bg-red-500 hover:bg-red-600 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted transition-all duration-300",
  success: "bg-green-600 hover:bg-green-700 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted transition-all duration-300",
};

const sizes = {
  sm: "h-7 px-3 text-xs rounded-md",
  md: "h-9 px-4 text-sm rounded-lg",
  lg: "h-11 px-6 text-sm rounded-lg",
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
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 ease-out cursor-pointer",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
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
      {iconRight && !loading && (
        <span className="material-symbols-outlined text-[18px]">{iconRight}</span>
      )}
    </button>
  );
}
