"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTheme } from "@/shared/hooks/useTheme";
import ChangelogModal from "./ChangelogModal";
import { ConfirmModal } from "./Modal";

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      <span className={`material-symbols-outlined text-[20px] ${danger ? "" : "text-text-muted"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState("");
  const [updateError, setUpdateError] = useState(null);
  const { toggleTheme, isDark } = useTheme();
  const menuRef = useRef(null);

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          title="Menu"
        >
          <span className="material-symbols-outlined">grid_view</span>
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden py-1">
            <MenuItem
              icon="history"
              label="Change Log"
              onClick={() => { close(); setChangelogOpen(true); }}
            />
            <MenuItem
              icon={isDark ? "light_mode" : "dark_mode"}
              label="Theme"
              onClick={() => { toggleTheme(); close(); }}
            />
            <MenuItem
              icon="system_update"
              label="Update"
              onClick={() => { close(); setUpdateOpen(true); }}
            />
            <MenuItem
              icon="power_settings_new"
              label="Shutdown"
              danger
              onClick={() => { close(); setShutdownOpen(true); }}
            />
            <MenuItem
              icon="logout"
              label="Logout"
              danger
              onClick={() => { close(); onLogout(); }}
            />
          </div>
        )}
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
      
      <ConfirmModal
        isOpen={updateOpen}
        onClose={() => {
          if (!isUpdating) {
            setUpdateOpen(false);
            setUpdateError(null);
            setUpdateStatusText("");
          }
        }}
        onConfirm={async () => {
          if (isUpdating) return;
          if (updateError) {
            setUpdateError(null);
            setUpdateOpen(false);
            return;
          }
          setIsUpdating(true);
          setUpdateError(null);
          setUpdateStatusText("Memulai proses update di latar belakang...");
          try {
            await fetch("/api/auto-update", { method: "POST" });
            const startTime = Date.now();
            const pollTimer = setInterval(async () => {
              try {
                const res = await fetch("/api/auto-update");
                if (res.ok) {
                  const data = await res.json();
                  if (data.status === "updating" || data.status === "building") {
                    setUpdateStatusText(data.message || "Sedang memproses pembaruan...");
                  } else if (data.status === "conflict" || data.status === "error") {
                    clearInterval(pollTimer);
                    setIsUpdating(false);
                    setUpdateError(data.message || "Pembaruan gagal dijalankan.");
                  } else if (data.status === "success") {
                    clearInterval(pollTimer);
                    setUpdateStatusText("Pembaruan selesai! Memuat ulang...");
                    setTimeout(() => window.location.reload(), 2000);
                  }
                }
              } catch {}
              if (Date.now() - startTime > 300000) {
                clearInterval(pollTimer);
                setIsUpdating(false);
                setUpdateError("Batas waktu update (5 menit) terlampaui.");
              }
            }, 2500);
          } catch (e) {
            setIsUpdating(false);
            setUpdateError("Gagal menghubungi server: " + e.message);
          }
        }}
        title={updateError ? "Pembaruan Gagal" : "Update 9Router"}
        message={
          updateError
            ? updateError
            : isUpdating
              ? updateStatusText || "Memperbarui kode dan container Docker di latar belakang... Mohon tunggu."
              : "Tindakan ini akan menarik branch master terbaru dan melakukan build container Docker di latar belakang secara otomatis. Lanjutkan?"
        }
        confirmText={updateError ? "Tutup" : isUpdating ? "Memproses..." : "Mulai Update"}
        cancelText={isUpdating || updateError ? "" : "Batal"}
        variant={updateError ? "danger" : "primary"}
        loading={isUpdating}
      />

      <ConfirmModal
        isOpen={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />
    </>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
