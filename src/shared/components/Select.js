"use client";

import { cn } from "@/shared/utils/cn";

const SIZES = { sm: "h-9 py-1", md: "py-2.5", lg: "py-3" };

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
  size = "md",
  ...props
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "w-full px-3 pr-10 text-text-main",
            SIZES[size] || SIZES.md,
            "bg-surface-2 border border-transparent rounded-[10px] appearance-none",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
            "transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            "text-[16px] sm:text-sm",
            error && "ring-1 ring-red-500 focus:ring-2 focus:ring-red-500/40 border-red-500/40",
            selectClassName
          )}
          {...props}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {/* Options with a `group` render inside <optgroup label={groupLabel}>, in first-seen order. */}
          {options.map((option, i) => {
            if (!option.group) return <option key={option.value} value={option.value}>{option.label}</option>;
            if (options.findIndex(o => o.group === option.group) !== i) return null;
            return (
              <optgroup key={`g:${option.group}`} label={option.groupLabel || option.group}>
                {options.filter(o => o.group === option.group).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-text-muted">
          <span className="material-symbols-outlined text-[20px]">expand_more</span>
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
