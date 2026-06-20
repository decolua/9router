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

  const loaded = !loading && (data || error);
  const channels = data?.channels || [];
  const showRu = loaded;
  const totalChannels = channels.length + 1; // + RU

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

          {showRu && (
            <>
              {(data?.message) && (
                <p className="text-text-muted text-sm mb-6 text-center">{data.message}</p>
              )}

              {/* Original channels + RU channel combined */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {channels.map((ch, i) => (
                  <DonateChannelCard key={ch.id || i} channel={ch} />
                ))}
                {/* ЮMoney — всегда 4-й */}
                <div className="flex flex-col items-center p-4 rounded-xl border border-black/10 dark:border-white/10 bg-surface/50 hover:border-pink-500/40 transition-colors">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                    style={{ backgroundColor: `${RU_CHANNEL.color}20`, color: RU_CHANNEL.color }}
                  >
                    <span className="material-symbols-outlined text-[26px]">{RU_CHANNEL.icon}</span>
                  </div>
                  <div className="font-semibold text-text-main mb-1">{RU_CHANNEL.label}</div>
                  <div className="text-xs text-text-muted mb-3 text-center">{RU_CHANNEL.description}</div>
                  <div className="w-full rounded-lg overflow-hidden border border-black/10 dark:border-white/10 bg-white mb-2">
                    <iframe
                      src="https://yoomoney.ru/quickpay/fundraise/widget?billNumber=1IH1PNNMFKP.260620&"
                      width="100%"
                      height="240"
                      frameBorder="0"
                      allowTransparency="true"
                      scrolling="no"
                      title="ЮMoney QR"
                    />
                  </div>
                  <a
                    href={RU_CHANNEL.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: RU_CHANNEL.color }}
                  >
                    Открыть
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  </a>
                </div>
              </div>

              {error && !data && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <p className="text-text-muted text-sm text-center">
                    Если форк пригодился — можно сказать спасибо ☕
                  </p>
                  <a
                    href={RU_CHANNEL.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                    style={{ backgroundColor: RU_CHANNEL.color }}
                  >
                    <span className="material-symbols-outlined text-[20px]">{RU_CHANNEL.icon}</span>
                    Открыть ЮMoney
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function DonateChannelCard({ channel }) {
  const { label, description, icon, color, url } = channel;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center p-4 rounded-xl border border-black/10 dark:border-white/10 bg-surface/50 hover:border-pink-500/40 transition-colors hover:no-underline"
    >
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
      <div
        className="mt-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity"
        style={{ backgroundColor: color }}
      >
        Open
        <span className="material-symbols-outlined text-[16px]">open_in_new</span>
      </div>
    </a>
  );
}

DonateModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
