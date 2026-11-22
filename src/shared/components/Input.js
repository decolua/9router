"use client";

import { cn } from "@/shared/utils/cn";

export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  ...props
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-muted">
            <span className="material-symbols-outlined text-[20px]">{icon}</span>
          </div>
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className={cn(
            // Same .chrome-field geometry as Select; only the icon inset is
            // per-instance, which is why it stays a utility.
            "neo-field chrome-field chrome-focus w-full text-text-main bg-surface-2",
            "border border-border/50 placeholder-text-muted/70",
            "focus:bg-surface focus:border-brand-500/50",
            disabled && "chrome-disabled",
            icon && "pl-10",
            error && "border-danger/40",
            inputClassName
          )}
          {...props}
        />
      </div>
      {error && (
        <p className="text-xs text-danger flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">report_problem</span>
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
