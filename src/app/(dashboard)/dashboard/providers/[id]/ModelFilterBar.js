"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import PropTypes from "prop-types";

const OPERATORS = [
  { value: "contains", label: "Contains" },
  { value: "notContains", label: "Does Not Contain" },
  { value: "startsWith", label: "Starts With" },
  { value: "endsWith", label: "Ends With" },
  { value: "equals", label: "Equals" },
];

const SORT_OPTIONS = [
  { value: "asc", label: "A → Z" },
  { value: "desc", label: "Z → A" },
];

/**
 * Apply Excel-style filter to a list of models
 * @param {Array} models - Array of model objects with at least { id, name? }
 * @param {Object} filter - { text: string, operator: string }
 * @returns {Array} Filtered models
 */
export function applyModelFilter(models, filter) {
  if (!filter || !filter.text || !filter.text.trim()) return models;

  const text = filter.text.trim().toLowerCase();
  const operator = filter.operator || "contains";

  return models.filter((model) => {
    const searchable = [
      model.id,
      model.name,
      model.fullModel,
      model.alias,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    switch (operator) {
      case "contains":
        return searchable.includes(text);
      case "notContains":
        return !searchable.includes(text);
      case "startsWith":
        return searchable.startsWith(text);
      case "endsWith":
        return searchable.endsWith(text);
      case "equals":
        return searchable === text;
      default:
        return searchable.includes(text);
    }
  });
}

/**
 * Sort models by ID
 * @param {Array} models - Array of model objects
 * @param {string} sortOrder - "asc" or "desc"
 * @returns {Array} Sorted models
 */
export function sortModels(models, sortOrder) {
  if (!sortOrder) return models;
  const sorted = [...models].sort((a, b) => {
    const aId = (a.id || "").toLowerCase();
    const bId = (b.id || "").toLowerCase();
    return sortOrder === "asc" ? aId.localeCompare(bId) : bId.localeCompare(aId);
  });
  return sorted;
}

/**
 * ModelFilterBar - Excel-style filter for model lists
 *
 * @param {Object} props
 * @param {Function} props.onFilterChange - Called with { text, operator } when filter changes
 * @param {Function} props.onSortChange - Called with sortOrder ("asc" / "desc" / null)
 * @param {Function} props.onSelectAll - Called with true (select all) or false (deselect all)
 * @param {boolean} props.allSelected - Whether all visible models are selected
 * @param {number} props.selectedCount - Number of currently selected models
 * @param {number} props.totalCount - Total number of models
 * @param {string} props.currentSort - Current sort order ("asc" / "desc" / null)
 * @param {Object} props.currentFilter - Current filter state { text, operator }
 */
export default function ModelFilterBar({
  onFilterChange,
  onSortChange,
  onSelectAll,
  allSelected,
  selectedCount,
  totalCount,
  currentSort,
  currentFilter,
}) {
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showSortPanel, setShowSortPanel] = useState(false);
  const filterPanelRef = useRef(null);
  const sortPanelRef = useRef(null);

  // Close panels on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(event.target)) {
        setShowFilterPanel(false);
      }
      if (sortPanelRef.current && !sortPanelRef.current.contains(event.target)) {
        setShowSortPanel(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFilterTextChange = useCallback(
    (text) => {
      onFilterChange?.({ text, operator: currentFilter?.operator || "contains" });
    },
    [onFilterChange, currentFilter?.operator]
  );

  const handleOperatorChange = useCallback(
    (operator) => {
      onFilterChange?.({ text: currentFilter?.text || "", operator });
    },
    [onFilterChange, currentFilter?.text]
  );

  const clearFilter = useCallback(() => {
    onFilterChange?.({ text: "", operator: "contains" });
    setShowFilterPanel(false);
  }, [onFilterChange]);

  const hasActiveFilter = currentFilter?.text && currentFilter.text.trim();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Filter input + button */}
      <div className="relative" ref={filterPanelRef}>
        <div className="flex items-center">
          <div className="relative">
            <input
              type="text"
              value={currentFilter?.text || ""}
              onChange={(e) => handleFilterTextChange(e.target.value)}
              placeholder="Filter models..."
              className="w-48 sm:w-56 px-3 py-1.5 pr-8 text-sm border border-r-0 border-border rounded-l-lg bg-background focus:outline-none focus:border-primary"
            />
            {hasActiveFilter && (
              <button
                onClick={clearFilter}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text hover:bg-bg-hover"
                title="Clear filter"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setShowFilterPanel(!showFilterPanel);
              setShowSortPanel(false);
            }}
            className={`px-2 py-1.5 border border-border rounded-r-lg hover:bg-bg-hover transition-colors ${hasActiveFilter ? "bg-primary/10 text-primary" : "text-text-muted"}`}
            title="Filter options"
          >
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
          </button>
        </div>

        {/* Filter operator dropdown */}
        {showFilterPanel && (
          <div className="absolute z-50 mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg p-2">
            <p className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">Operator</p>
            {OPERATORS.map((op) => (
              <button
                key={op.value}
                onClick={() => {
                  handleOperatorChange(op.value);
                  setShowFilterPanel(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${
                  currentFilter?.operator === op.value
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-text-main hover:bg-bg-hover"
                }`}
              >
                {op.label}
              </button>
            ))}
            <div className="border-t border-border mt-2 pt-2">
              <button
                onClick={clearFilter}
                className="w-full text-left px-3 py-1.5 text-sm text-text-muted hover:bg-bg-hover rounded-md transition-colors"
              >
                Clear Filter
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sort button */}
      <div className="relative" ref={sortPanelRef}>
        <button
          onClick={() => {
            setShowSortPanel(!showSortPanel);
            setShowFilterPanel(false);
          }}
          className={`px-2 py-1.5 border border-border rounded-lg hover:bg-bg-hover transition-colors ${currentSort ? "bg-primary/10 text-primary" : "text-text-muted"}`}
          title="Sort models"
        >
          <span className="material-symbols-outlined text-[18px]">
            {currentSort === "desc" ? "arrow_downward" : "sort"}
          </span>
        </button>

        {showSortPanel && (
          <div className="absolute z-50 mt-1 w-40 bg-surface border border-border rounded-lg shadow-lg p-2">
            <p className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">Sort</p>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onSortChange?.(currentSort === opt.value ? null : opt.value);
                  setShowSortPanel(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${
                  currentSort === opt.value
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-text-main hover:bg-bg-hover"
                }`}
              >
                {opt.label}
              </button>
            ))}
            {currentSort && (
              <button
                onClick={() => {
                  onSortChange?.(null);
                  setShowSortPanel(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-text-muted hover:bg-bg-hover rounded-md transition-colors"
              >
                Clear Sort
              </button>
            )}
          </div>
        )}
      </div>

      {/* Select all checkbox */}
      <div className="flex items-center gap-1.5 ml-2">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onSelectAll?.(!allSelected)}
          className="size-4 rounded border-border text-primary focus:ring-primary/20 cursor-pointer"
        />
        <span className="text-xs text-text-muted">
          {selectedCount > 0
            ? `${selectedCount} / ${totalCount} selected`
            : `${totalCount} models`}
        </span>
      </div>
    </div>
  );
}

ModelFilterBar.propTypes = {
  onFilterChange: PropTypes.func.isRequired,
  onSortChange: PropTypes.func.isRequired,
  onSelectAll: PropTypes.func.isRequired,
  allSelected: PropTypes.bool.isRequired,
  selectedCount: PropTypes.number.isRequired,
  totalCount: PropTypes.number.isRequired,
  currentSort: PropTypes.string,
  currentFilter: PropTypes.shape({
    text: PropTypes.string,
    operator: PropTypes.string,
  }),
};
