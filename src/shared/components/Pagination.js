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
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const windowSize = 4;
    const nearStart = currentPage <= 3;
    const nearEnd = currentPage >= totalPages - 2;

    let start;
    let end;

    if (nearStart) {
      start = 1;
      end = Math.min(totalPages - 1, windowSize);
    } else if (nearEnd) {
      end = totalPages - 1;
      start = Math.max(1, end - windowSize + 1);
    } else {
      start = currentPage;
      end = Math.min(totalPages - 1, start + windowSize - 1);
      if (end - start + 1 < windowSize) {
        start = Math.max(1, end - windowSize + 1);
      }
    }

    const pages = [];
    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();
  const firstPageVisible = pageNumbers[0] === 1;
  const lastPageVisible = pageNumbers[pageNumbers.length - 1] === totalPages;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-sm px-4 py-3 shadow-sm",
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {totalItems > 0 ? (
          <div className="text-sm text-text-muted">
            Showing <span className="font-medium text-text-main">{startItem}</span> to{" "}
            <span className="font-medium text-text-main">{endItem}</span> of{" "}
            <span className="font-medium text-text-main">{totalItems}</span> results
          </div>
        ) : (
          <div className="text-sm text-text-muted">No results</div>
        )}

        {onPageSizeChange && totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className={cn(
                "h-9 rounded-lg border border-black/10 dark:border-white/10 bg-surface px-3",
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
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1 justify-center sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="w-9 px-0"
            aria-label="Previous page"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </Button>

          {!firstPageVisible && (
            <>
              <Button
                variant={currentPage === 1 ? "primary" : "ghost"}
                size="sm"
                onClick={() => onPageChange(1)}
                className="w-9 px-0"
              >
                1
              </Button>
              {pageNumbers[0] > 2 && <span className="px-1 text-text-muted">...</span>}
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

          {!lastPageVisible && (
            <>
              {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                <span className="px-1 text-text-muted">...</span>
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
            aria-label="Next page"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </Button>
        </div>
      )}
    </div>
  );
}
