"use client";

import PropTypes from "prop-types";

/**
 * ModelBulkActions - Bulk action bar for selected models
 *
 * @param {Object} props
 * @param {number} props.selectedCount - Number of selected models
 * @param {Function} props.onEnable - Called when "Enable" is clicked
 * @param {Function} props.onDisable - Called when "Disable" is clicked
 * @param {Function} props.onDelete - Called when "Delete" is clicked
 * @param {Function} props.onClearSelection - Called to clear selection
 * @param {boolean} props.hideEnable - Whether to hide the Enable button
 * @param {boolean} props.isDisabled - Whether bulk actions are disabled (e.g., during operation)
 * @param {boolean} props.hideDisable - Whether to hide the Disable button
 * @param {boolean} props.hideDelete - Whether to hide the Delete button
 */
export default function ModelBulkActions({
  selectedCount,
  onEnable,
  onDisable,
  onDelete,
  onClearSelection,
  hideEnable = false,
  isDisabled = false,
  hideDisable = false,
  hideDelete = false,
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
      <span className="text-sm font-medium text-primary mr-2">
        {selectedCount} model{selectedCount !== 1 ? "s" : ""} selected
      </span>

      {!hideEnable && (
        <button
          onClick={onEnable}
          disabled={isDisabled}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
          Enable
        </button>
      )}

      {!hideDisable && (
        <button
          onClick={onDisable}
          disabled={isDisabled}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10 hover:bg-yellow-100 dark:hover:bg-yellow-500/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">block</span>
          Disable
        </button>
      )}

      {!hideDelete && (
        <button
          onClick={onDelete}
          disabled={isDisabled}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
          Delete
        </button>
      )}

      <button
        onClick={onClearSelection}
        disabled={isDisabled}
        className="ml-auto px-2 py-1.5 text-sm text-text-muted hover:text-text hover:bg-bg-hover rounded-md transition-colors"
        title="Clear selection"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}

ModelBulkActions.propTypes = {
  selectedCount: PropTypes.number.isRequired,
  onEnable: PropTypes.func.isRequired,
  onDisable: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onClearSelection: PropTypes.func.isRequired,
  hideEnable: PropTypes.bool,
  isDisabled: PropTypes.bool,
  hideDisable: PropTypes.bool,
  hideDelete: PropTypes.bool,
};
