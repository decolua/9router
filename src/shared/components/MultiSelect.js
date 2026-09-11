"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/shared/utils/cn";

export default function MultiSelect({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = "Select options",
  error,
  hint,
  disabled = false,
  required = false,
  className,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (optionValue) => {
    if (!value.includes(optionValue)) {
      onChange([...value, optionValue]);
    } else {
      onChange(value.filter((v) => v !== optionValue));
    }
    setInputValue("");
    inputRef.current?.focus();
  };

  const handleRemove = (optionValue, e) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== optionValue));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      const val = inputValue.trim();
      if (!value.includes(val)) {
        onChange([...value, val]);
      }
      setInputValue("");
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const filteredOptions = options.filter(
    (opt) => 
      opt.label.toLowerCase().includes(inputValue.toLowerCase()) || 
      opt.value.toLowerCase().includes(inputValue.toLowerCase())
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)} ref={containerRef}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      
      <div 
        className={cn(
          "relative w-full min-h-[44px] flex flex-wrap items-center gap-2 p-2 text-sm text-text-main",
          "bg-surface-2 border border-transparent rounded-[10px]",
          "transition-all duration-150",
          isOpen && "ring-2 ring-brand-500/30 border-brand-500/40",
          disabled && "opacity-50 cursor-not-allowed",
          error && "ring-1 ring-red-500 border-red-500/40 focus-within:ring-2 focus-within:ring-red-500/40"
        )}
        onClick={() => !disabled && setIsOpen(true)}
      >
        {value.map((val) => {
          const option = options.find((opt) => opt.value === val);
          const displayLabel = option ? option.label : val;
          return (
            <span 
              key={val} 
              className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded text-xs"
            >
              {displayLabel}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => handleRemove(val, e)}
                  className="hover:text-primary/70 focus:outline-none"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </span>
          );
        })}
        
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={disabled}
          className="flex-1 min-w-[120px] bg-transparent border-none focus:outline-none focus:ring-0 p-0 text-sm placeholder-text-muted/70"
        />
        
        <div className="flex items-center pr-1 text-text-muted cursor-pointer" onClick={() => !disabled && setIsOpen(!isOpen)}>
          <span className="material-symbols-outlined text-[20px]">
            {isOpen ? "expand_less" : "expand_more"}
          </span>
        </div>

        {isOpen && !disabled && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-surface-1 border border-border shadow-lg rounded-lg py-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = value.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => handleSelect(opt.value)}
                    className={cn(
                      "px-3 py-2 text-sm cursor-pointer hover:bg-surface-2 flex items-center justify-between",
                      isSelected && "text-primary bg-primary/5"
                    )}
                  >
                    <span>{opt.label}</span>
                    {isSelected && (
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-2 text-sm text-text-muted">
                {inputValue ? "Press Enter to add custom pattern" : "No options found"}
              </div>
            )}
          </div>
        )}
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
