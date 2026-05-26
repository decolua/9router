"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { marked } from "marked";
import { GITHUB_CONFIG } from "@/shared/constants/config";

marked.setOptions({ gfm: true, breaks: true });

function ChangelogModalContent({ onClose }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const modalRef = useRef(null);

  useEffect(() => {
    const abortController = new AbortController();

    const loadChangelog = async () => {
      try {
        const res = await fetch(GITHUB_CONFIG.changelogUrl, {
          signal: abortController.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const md = await res.text();
        setHtml(marked.parse(md));
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }

        setError(err.message || "Failed to load");
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadChangelog();

    return () => {
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-3xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <h2 className="text-lg font-semibold text-text-main">Change Log</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <span className="material-symbols-outlined animate-spin mr-2">
                progress_activity
              </span>
              Loading...
            </div>
          )}
          {error && (
            <div className="text-red-500 py-4">
              Failed to load changelog: {error}
            </div>
          )}
          {!loading && !error && html && (
            <div
              className="changelog-body text-text-main"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

ChangelogModalContent.propTypes = {
  onClose: PropTypes.func.isRequired,
};

export default function ChangelogModal({ isOpen, onClose }) {
  if (!isOpen || typeof document === "undefined") return null;

  return <ChangelogModalContent key={isOpen ? "open" : "closed"} onClose={onClose} />;
}

ChangelogModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
