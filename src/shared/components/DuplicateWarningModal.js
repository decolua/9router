"use client";

import PropTypes from "prop-types";
import { Modal, Button, Badge } from "@/shared/components";

/**
 * DuplicateWarningModal - Shows warning when duplicate connection detected
 * Provides options to replace, keep both, or cancel
 */
export default function DuplicateWarningModal({
  isOpen,
  duplicate,
  reason,
  onReplace,
  onKeepBoth,
  onCancel,
}) {
  if (!duplicate) return null;

  return (
    <Modal
      isOpen={isOpen}
      title="Duplicate Connection Detected"
      onClose={onCancel}
      maxWidth="md"
    >
      <div className="flex flex-col gap-4">
        {/* Warning Icon */}
        <div className="flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-orange-500">
              warning
            </span>
          </div>
        </div>

        {/* Message */}
        <div className="text-center">
          <p className="text-text-main font-medium mb-2">
            A connection with the same credentials already exists
          </p>
          <p className="text-sm text-text-muted">{reason}</p>
        </div>

        {/* Existing Connection Info */}
        <div className="bg-sidebar/50 rounded-lg p-4 border border-border">
          <p className="text-xs text-text-muted mb-2">Existing Connection</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{duplicate.name}</p>
              {duplicate.email && (
                <p className="text-xs text-text-muted mt-1">{duplicate.email}</p>
              )}
            </div>
            <Badge
              variant={duplicate.isActive ? "success" : "default"}
              size="sm"
            >
              {duplicate.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <span>Priority: {duplicate.priority}</span>
            <span>•</span>
            <span>
              Added: {new Date(duplicate.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-2">
          <Button
            onClick={onReplace}
            variant="primary"
            icon="swap_horiz"
            fullWidth
          >
            Replace Existing Connection
          </Button>
          <Button
            onClick={onKeepBoth}
            variant="secondary"
            icon="add"
            fullWidth
          >
            Keep Both (Add as Fallback)
          </Button>
          <Button onClick={onCancel} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>

        {/* Info Box */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
          <div className="flex gap-2">
            <span className="material-symbols-outlined text-blue-500 text-sm">
              info
            </span>
            <p className="text-xs text-text-muted">
              <strong>Replace:</strong> Updates the existing connection with new
              credentials while preserving priority.
              <br />
              <strong>Keep Both:</strong> Adds as a new connection with lower
              priority for fallback.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

DuplicateWarningModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  duplicate: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    priority: PropTypes.number,
    isActive: PropTypes.bool,
    createdAt: PropTypes.string,
  }),
  reason: PropTypes.string,
  onReplace: PropTypes.func.isRequired,
  onKeepBoth: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};