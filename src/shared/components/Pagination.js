"use client";

import { useState } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";
import SegmentedControl from "./SegmentedControl";

export default function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  className,
  pageSizeOptions = [10, 20, 50],
  allowCustomPageSize = false,
  maxPageSize = 500,
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState(String(pageSize));

  const commitCustomPageSize = () => {
    const parsed = Number.parseInt(customInput, 10);
    if (!Number.isFinite(parsed)) {
      setCustomInput(String(pageSize));
      return;
    }
    const next = Math.min(maxPageSize, Math.max(1, parsed));
    setCustomInput(String(next));
    // Committing an unchanged value must not re-trigger onPageSizeChange —
    // callers reset to page 1 on every change, which would be surprising here.
    if (next !== pageSize) onPageSizeChange(next);
  };

  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getPageNumbers = () => {
    const pages = [];
    const showMax = 5;

    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, start + showMax - 1);

    if (end - start + 1 < showMax) {
      start = Math.max(1, end - showMax + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className={cn("flex flex-col gap-2 py-4 px-2", className)}>
      {/* Row 1: info (left) + page-size selector (right) */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        {totalItems > 0 && (
          <div className="whitespace-nowrap text-sm text-text-muted">
            Showing <span className="font-medium text-text-main">{startItem}</span> to{" "}
            <span className="font-medium text-text-main">{endItem}</span> of{" "}
            <span className="font-medium text-text-main">{totalItems}</span> results
          </div>
        )}

        {/* Page size selector */}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">Rows:</span>
            <SegmentedControl
              size="sm"
              value={customMode && allowCustomPageSize ? "__custom__" : String(pageSize)}
              options={[
                ...pageSizeOptions.map((size) => ({
                  value: String(size),
                  label: String(size),
                })),
                ...(allowCustomPageSize
                  ? [{ value: "__custom__", label: "Custom" }]
                  : []),
              ]}
              onChange={(value) => {
                if (value === "__custom__") {
                  setCustomMode(true);
                  setCustomInput(String(pageSize));
                  return;
                }
                setCustomMode(false);
                onPageSizeChange(Number(value));
              }}
            />
            {customMode && allowCustomPageSize && (
              <input
                type="number"
                min="1"
                max={String(maxPageSize)}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onBlur={commitCustomPageSize}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCustomPageSize();
                }}
                className={cn(
                  "h-7 w-20 rounded-[8px] border border-border bg-surface-2",
                  "px-2 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30",
                  "transition-all"
                )}
                style={{ colorScheme: 'auto' }}
                aria-label="Custom accounts per page"
              />
            )}
          </div>
        )}
      </div>

      {/* Row 2: nav — right-aligned; its width never affects other rows */}
      {totalPages > 1 && (
        <div className="flex justify-end">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="w-9 px-0"
              aria-label="Go to previous page"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </Button>

            {/* Mobile: compact Page X of Y between the chevrons */}
            <span className="px-2 text-sm text-text-muted sm:hidden">
              Page <span className="font-medium text-text-main">{currentPage}</span> of{" "}
              <span className="font-medium text-text-main">{totalPages}</span>
            </span>

            {/* Desktop: numbered window with first/last + ellipsis, numbers tight
                between the chevrons. It lives on its own row (row 2), so the
                variable 7–9 button count never affects any other layout. */}
            <div className="hidden items-center gap-1 sm:flex">
              {pageNumbers[0] > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(1)}
                  className="w-9 px-0"
                  aria-label="Go to first page"
                >
                  1
                </Button>
              )}
              {pageNumbers[0] > 2 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(Math.max(1, currentPage - 5))}
                  className="w-9 px-0"
                  aria-label="Jump 5 pages back"
                >
                  ...
                </Button>
              )}

              {pageNumbers.map((page) => {
                const isCurrent = currentPage === page;
                return (
                  <Button
                    key={page}
                    variant={isCurrent ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => onPageChange(page)}
                    className="w-9 px-0"
                    aria-label={`Go to page ${page}`}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    {page}
                  </Button>
                );
              })}

              {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 5))}
                  className="w-9 px-0"
                  aria-label="Jump 5 pages forward"
                >
                  ...
                </Button>
              )}
              {pageNumbers[pageNumbers.length - 1] < totalPages && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(totalPages)}
                  className="w-9 px-0"
                  aria-label="Go to last page"
                >
                  {totalPages}
                </Button>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="w-9 px-0"
              aria-label="Go to next page"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
