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
        "flex flex-col sm:flex-row items-center justify-between gap-4 py-4",
        className
      )}
    >
      {/* Info text */}
      {totalItems > 0 && (
        <div className="text-sm text-text-muted">
          Showing <span className="font-medium text-text-main">{startItem}</span> to{" "}
          <span className="font-medium text-text-main">{endItem}</span> of{" "}
          <span className="font-medium text-text-main">{totalItems}</span> results
        </div>
      )}

      <div className="flex items-center gap-4">
        {/* Page size selector */}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className={cn(
                "h-9 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "cursor-pointer"
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
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="w-9 px-0"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </Button>

            {pageNumbers[0] > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(1)}
                  className="w-9 px-0"
                >
                  1
                </Button>
                {pageNumbers[0] > 2 && (
                  <span className="text-text-muted px-1">...</span>
                )}
              </>
            )}

            {pageNumbers.map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? "primary" : "ghost"}
                size="sm"
                onClick={() => onPageChange(page)}
                className="w-9 px-0"
              >
                {page}
              </Button>
            ))}

            {pageNumbers[pageNumbers.length - 1] < totalPages && (
              <>
                {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                  <span className="text-text-muted px-1">...</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPageChange(totalPages)}
                  className="w-9 px-0"
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
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
