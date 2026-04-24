"use client";

import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import { GITHUB_CONFIG } from "@/shared/constants/config";
import { X, CircleNotch as Loader2, WarningCircle } from "@phosphor-icons/react";

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || html) return;
    
    const fetchChangelog = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(GITHUB_CONFIG.changelogUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = await res.text();
        const parsed = await marked.parse(md);
        setHtml(parsed);
      } catch (err: any) {
        setError(err.message || "Failed to load changelog");
      } finally {
        setLoading(false);
      }
    };

    fetchChangelog();
  }, [isOpen, html]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal content */}
      <div
        ref={modalRef}
        className="relative w-full bg-background border border-border/50 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-3xl flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/5">
          <h2 className="text-lg font-bold tracking-tight text-foreground pl-2">System Changelog</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/10 transition-colors"
            aria-label="Close"
          >
            <X className="size-5" weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="p-8 overflow-y-auto flex-1 bg-background custom-scrollbar">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <Loader2 className="size-8 animate-spin text-primary" weight="bold" />
              <p className="text-xs font-bold uppercase tracking-widest animate-pulse">Syncing releases...</p>
            </div>
          )}
          
          {error && (
            <div className="flex flex-col items-center justify-center py-10 text-destructive gap-2">
              <WarningCircle className="size-10" weight="bold" />
              <p className="text-sm font-bold uppercase tracking-wide">Failed to load: {error}</p>
            </div>
          )}
          
          {!loading && !error && html && (
            <div
              className="changelog-body prose prose-invert prose-sm max-w-none 
                prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-foreground
                prose-p:text-muted-foreground prose-p:font-medium prose-p:leading-relaxed
                prose-li:text-muted-foreground prose-li:font-medium
                prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
                prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
