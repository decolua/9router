"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";

export default function DonateModal({ isOpen, onClose }) {
  const modalRef = useRef(null);

  const handleClickOutside = (e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
  };

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={handleClickOutside}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-sm flex flex-col"
      >
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-pink-500">volunteer_activism</span>
            Поддержать проект
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-4 flex flex-col items-center gap-3">
          <p className="text-text-muted text-sm text-center">
            Если форк пригодился — можно сказать спасибо ☕
          </p>
          <div className="w-full rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-white">
            <iframe
              src="https://yoomoney.ru/quickpay/fundraise/widget?billNumber=1IH1PNNMFKP.260620&"
              width="100%"
              height="420"
              frameBorder="0"
              allowTransparency="true"
              scrolling="no"
              title="ЮMoney Donate"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

DonateModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
