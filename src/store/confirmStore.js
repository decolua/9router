/**
 * Confirm Store — Zustand-based global confirmation dialog.
 *
 * Replaces native window.confirm() with a styled, app-consistent dialog.
 * Promise-based so callers can `await` the user's choice:
 *
 *   import { confirmDialog } from "@/store/confirmStore";
 *   if (!(await confirmDialog({ message: "Delete this?", danger: true }))) return;
 *
 * The dialog itself is rendered once, globally, by DashboardLayout.
 */

import { create } from "zustand";

export const useConfirmStore = create((set, get) => ({
  isOpen: false,
  options: {},
  _resolve: null,

  /**
   * Open the confirm dialog and resolve with the user's choice.
   * @param {Object} options
   * @param {string} [options.title]
   * @param {string} [options.message]
   * @param {string} [options.confirmText]
   * @param {string} [options.cancelText]
   * @param {boolean} [options.danger] - Use the destructive (red) confirm button.
   * @returns {Promise<boolean>}
   */
  confirm: (options = {}) =>
    new Promise((resolve) => {
      // If a dialog is already open, resolve it as cancelled first.
      const prev = get()._resolve;
      if (prev) prev(false);
      set({ isOpen: true, options, _resolve: resolve });
    }),

  handleConfirm: () => {
    const resolve = get()._resolve;
    set({ isOpen: false, _resolve: null });
    if (resolve) resolve(true);
  },

  handleCancel: () => {
    const resolve = get()._resolve;
    set({ isOpen: false, _resolve: null });
    if (resolve) resolve(false);
  },
}));

/**
 * Imperative helper usable outside React components / inside event handlers.
 * @param {Object} options - See useConfirmStore.confirm
 * @returns {Promise<boolean>}
 */
export const confirmDialog = (options) =>
  useConfirmStore.getState().confirm(options);
