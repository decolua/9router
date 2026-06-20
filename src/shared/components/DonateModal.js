"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";

const OTHER_CHANNELS = [
  {
    id: "boosty",
    label: "Boosty",
    description: "Подписка или разовый донат",
    icon: "favorite",
    color: "#F56B2F",
    url: "https://boosty.to/9router-russian",
  },
  {
    id: "tbank",
    label: "T-Bank",
    description: "СБП по номеру телефона",
    icon: "credit_card",
    color: "#FFDD2D",
    url: "https://github.com/mdn77/9router-russian/releases",
  },
  {
    id: "usdt",
    label: "USDT TRC20",
    description: "Крипта, без границ",
    icon: "currency_bitcoin",
    color: "#26A17B",
    url: "https://github.com/mdn77/9router-russian/releases",
  },
];

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
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-xl flex flex-col max-h-[90vh]"
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

        <div className="p-4 overflow-y-auto flex-1 flex flex-col items-center gap-4">
          <p className="text-text-muted text-sm text-center">
            Если форк пригодился — можно сказать спасибо ☕
          </p>

          {/* ЮMoney — основной виджет */}
          <div className="w-full max-w-[340px] rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-white">
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

          {/* Остальные способы */}
          <div className="grid grid-cols-3 gap-3 w-full max-w-[340px]">
            {OTHER_CHANNELS.map((ch) => (
              <a
                key={ch.id}
                href={ch.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center p-3 rounded-xl border border-black/10 dark:border-white/10 bg-surface/50 hover:border-pink-500/40 transition-colors hover:no-underline"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                  style={{ backgroundColor: `${ch.color}20`, color: ch.color }}
                >
                  <span className="material-symbols-outlined text-[22px]">{ch.icon}</span>
                </div>
                <div className="text-xs font-semibold text-text-main">{ch.label}</div>
              </a>
            ))}
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
