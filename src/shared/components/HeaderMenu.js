"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import ThemeToggle from "./ThemeToggle";
import LanguageSwitcher from "./LanguageSwitcher";
import NineRemoteButton from "./NineRemoteButton";
import ChangelogModal from "./ChangelogModal";

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const menuRef = useRef(null);

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

  const openChangelog = () => {
    setIsOpen(false);
    setChangelogOpen(true);
  };

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          title="Menu"
        >
          <span className="material-symbols-outlined">more_vert</span>
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden py-1">
            <button
              onClick={openChangelog}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px] text-text-muted">history</span>
              Change Log
            </button>

            <div className="flex items-center px-2 py-1 gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
              <LanguageSwitcher />
            </div>

            <div className="flex items-center px-2 py-1 gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
              <ThemeToggle />
              <span className="text-sm text-text-main">Theme</span>
            </div>

            <button
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
              Logout
            </button>

            <div className="flex items-center px-2 py-1 gap-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
              <NineRemoteButton />
            </div>
          </div>
        )}
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
