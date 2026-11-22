"use client";

import { cn } from "@/shared/utils/cn";
import Button from "./Button";

export default function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  className,
}) {
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
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2",
        className
      )}
    >
      {/* Info text. Tabular figures: without them the "Showing 1 to 20 of 1,234"
          line reflows its own width on every page change, because proportional
          digits are not equal-width. */}
      {totalItems > 0 && (
        <div className="text-sm text-text-muted" aria-live="polite">
          Showing <span className="font-medium text-text-main tabular-nums">{startItem}</span> to{" "}
          <span className="font-medium text-text-main tabular-nums">{endItem}</span> of{" "}
          <span className="font-medium text-text-main tabular-nums">{totalItems}</span> results
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
        {/* Page size selector */}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <label htmlFor="pagination-page-size" className="text-sm text-text-muted">Rows:</label>
            <select
              id="pagination-page-size"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              /* Height, radius and focus all come from the contract, so this
                 field matches the Input/Select controls next to it instead of
                 being a one-off rounded-lg with a 20%-opacity ring. */
              className={cn(
                "chrome-focus h-[var(--height-md)] rounded-[var(--r-control)] px-2",
                "border border-border bg-surface",
                "text-sm text-text-main"
              )}
            >
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}

        {totalPages > 1 && (
          <nav className="flex items-center gap-1" aria-label="Pagination">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="w-9 px-0"
              aria-label="Previous page"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back_ios</span>
            </Button>

            {pageNumbers[0] > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(1)}
                  className="w-9 px-0 hidden sm:inline-flex"
                  aria-label="Page 1"
                >
                  1
                </Button>
                {pageNumbers[0] > 2 && (
                  <span className="text-text-muted px-1 hidden sm:inline" aria-hidden="true">...</span>
                )}
              </>
            )}

            {pageNumbers.map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? "primary" : "ghost"}
                size="sm"
                onClick={() => onPageChange(page)}
                className={cn(
                  "w-9 px-0 tabular-nums",
                  currentPage === page ? "inline-flex" : "hidden sm:inline-flex"
                )}
                aria-current={currentPage === page ? "page" : undefined}
                aria-label={`Page ${page}`}
              >
                {page}
              </Button>
            ))}

            {pageNumbers[pageNumbers.length - 1] < totalPages && (
              <>
                {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                  <span className="text-text-muted px-1 hidden sm:inline" aria-hidden="true">...</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(totalPages)}
                  className="w-9 px-0 hidden sm:inline-flex"
                  aria-label={`Page ${totalPages}`}
                >
                  {totalPages}
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="w-9 px-0"
              aria-label="Next page"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_forward_ios</span>
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}
