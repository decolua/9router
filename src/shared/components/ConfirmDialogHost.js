"use client";

import { ConfirmModal } from "./Modal";
import { useConfirmStore } from "@/store/confirmStore";

/**
 * Global host for the app's confirmation dialog. Mounted once (in
 * DashboardLayout); driven imperatively via `confirmDialog()` /
 * `useConfirmStore`. Replaces native window.confirm().
 */
export default function ConfirmDialogHost() {
  const isOpen = useConfirmStore((s) => s.isOpen);
  const options = useConfirmStore((s) => s.options);
  const handleConfirm = useConfirmStore((s) => s.handleConfirm);
  const handleCancel = useConfirmStore((s) => s.handleCancel);

  const {
    title = "Are you sure?",
    message = "",
    confirmText = "Confirm",
    cancelText = "Cancel",
    danger = false,
  } = options || {};

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={handleCancel}
      onConfirm={handleConfirm}
      title={title}
      message={message}
      confirmText={confirmText}
      cancelText={cancelText}
      variant={danger ? "danger" : "primary"}
    />
  );
}
