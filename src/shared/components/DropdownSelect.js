"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

export default function DropdownSelect({
  label,
  options = [],
  value,
  onChange,
  placeholder = "请选择",
  searchable = false,
  searchPlaceholder = "搜索选项",
  disabled = false,
  className,
  buttonClassName,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => String(option.value) === String(value));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = useMemo(
    () => normalizedQuery
      ? options.filter((option) => String(option.label).toLowerCase().includes(normalizedQuery))
      : options,
    [options, normalizedQuery],
  );

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const selectOption = (option) => {
    onChange?.(option.value, option);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={cn("relative flex min-w-0 flex-col gap-1.5", className)}>
      {label && <span className="text-xs text-text-muted">{label}</span>}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-sm text-text-main outline-none transition-colors",
          "hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
          buttonClassName,
        )}
      >
        <span className={cn("min-w-0 truncate whitespace-nowrap", !selected && "text-text-muted")}>{selected?.label || placeholder}</span>
        <span className={cn("material-symbols-outlined shrink-0 text-[18px] text-text-muted transition-transform", open && "rotate-180")}>expand_more</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">search</span>
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-8 w-full rounded-md border border-border bg-bg-base pl-7 pr-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
          )}
          <div role="listbox" className="max-h-64 overflow-y-auto p-1 custom-scrollbar">
            {visibleOptions.length ? visibleOptions.map((option) => {
              const active = String(option.value) === String(value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => selectOption(option)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-bg-hover",
                    active && "bg-primary/10 text-primary",
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {active && <span className="material-symbols-outlined shrink-0 text-[17px]">check</span>}
                </button>
              );
            }) : <p className="px-3 py-5 text-center text-xs text-text-muted">没有匹配项</p>}
          </div>
        </div>
      )}
    </div>
  );
}

DropdownSelect.propTypes = {
  label: PropTypes.string,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired, label: PropTypes.node.isRequired })),
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  searchable: PropTypes.bool,
  searchPlaceholder: PropTypes.string,
  disabled: PropTypes.bool,
  className: PropTypes.string,
  buttonClassName: PropTypes.string,
};
