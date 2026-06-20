"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { GITHUB_CONFIG } from "@/shared/constants/config";

const RU_CHANNEL = {
  id: "yoomoney",
  label: "ЮMoney",
  description: "Карта, СБП, телефон — любая сумма",
  icon: "account_balance",
  color: "#FFCC00",
  url: "https://yoomoney.ru/fundraise/1IH1PNNMFKP.260620",
  qr: "https://yoomoney.ru/fundraise/1IH1PNNMFKP.260620",
};

export default function DonateModal({ isOpen, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen || data) return;
    setLoading(true);
    setError("");
    fetch(GITHUB_CONFIG.donateUrl, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [isOpen, data]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  // Combine original channels + RU channel
  const channels = [
    ...(data?.channels || []),
    RU_CHANNEL,
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-3xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-pink-500">volunteer_activism</span>
            {data?.title || "Поддержать проект"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
              Loading...
            </div>
          )}

          {((!loading && data) || error) && (
            <>
              {(data?.message || !error) && (
                <p className="text-text-muted text-sm mb-6 text-center">
                  {data?.message || "Если форк пригодился — можно сказать спасибо ☕"}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {channels.map((ch, i) => (
                  <DonateChannelCard key={ch.id || i} channel={ch} />
                ))}
              </div>
            </>
          )}

          {!loading && error && (
            <div className="text-center py-4">
              <p className="text-text-muted text-sm mb-4">Если форк пригодился — можно сказать спасибо ☕</p>
              <a
                href={RU_CHANNEL.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: RU_CHANNEL.color }}
              >
                <span className="material-symbols-outlined text-[20px]">{RU_CHANNEL.icon}</span>
                ЮMoney — любая сумма
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function DonateChannelCard({ channel }) {
  const { label, description, icon, color, url, qr } = channel;
  const content = (
    <>
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
        style={{ backgroundColor: `${color}20`, color }}
      >
        <span className="material-symbols-outlined text-[26px]">{icon}</span>
      </div>
      <div className="font-semibold text-text-main mb-1">{label}</div>
      {description && (
        <div className="text-xs text-text-muted mb-3 text-center">{description}</div>
      )}
      {qr && channel.id === "yoomoney" && (
        <iframe
          src="https://yoomoney.ru/quickpay/fundraise/widget?billNumber=1IH1PNNMFKP.260620&"
          width="100%"
          height="260"
          frameBorder="0"
          allowTransparency="true"
          scrolling="no"
          title="ЮMoney QR"
          className="rounded-lg"
        />
      )}
    </>
  );

  return (
    <div className="flex flex-col items-center p-4 rounded-xl border border-black/10 dark:border-white/10 bg-surface/50 hover:border-pink-500/40 transition-colors">
      {content}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: color }}
        >
          {channel.id === "yoomoney" ? "Оплатить" : "Open"}
          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
        </a>
      )}
    </div>
  );
}

DonateModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
