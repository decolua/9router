"use client";

import { cn } from "@/shared/utils/cn";

export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
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
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className={cn(
            // .chrome-field owns padding, radius and the 16px mobile size so
            // this and Input cannot drift apart.
            "neo-field chrome-field chrome-focus w-full pr-10 text-text-main",
            "bg-surface-2 border border-border/50 appearance-none",
            "focus:bg-surface focus:border-brand-500/50",
            disabled && "chrome-disabled",
            error && "border-danger/40",
            selectClassName
          )}
          {...props}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-text-muted">
          <span className="material-symbols-outlined text-[20px]">keyboard_arrow_down</span>
        </div>
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
