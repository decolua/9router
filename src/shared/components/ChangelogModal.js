"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const DECOLUA_URL = "https://raw.githubusercontent.com/decolua/9router/refs/heads/master/CHANGELOG.md";
const SERENHOPE_URL = "https://raw.githubusercontent.com/serenhope/9router/refs/heads/master/CHANGELOG.md";
const CHANGELOG_API_URL = "/api/changelog";

function asMarkdown(value) {
  if (typeof value !== "string") return "";
  return value.trim() ? value : "";
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

// Local endpoint first (works offline and before any push), raw GitHub only for what it lacks.
async function loadChangelogs() {
  const local = await fetchJson(CHANGELOG_API_URL);
  let decoluaMd = asMarkdown(local?.official);
  let serenhopeMd = asMarkdown(local?.custom);

  if (!decoluaMd && !serenhopeMd) {
    return Promise.all([fetchText(DECOLUA_URL), fetchText(SERENHOPE_URL)]);
  }
  if (!decoluaMd) decoluaMd = await fetchText(DECOLUA_URL);
  if (!serenhopeMd) serenhopeMd = await fetchText(SERENHOPE_URL);
  return [decoluaMd, serenhopeMd];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Split markdown into per-version sections.
// A version boundary is an h1/h2 heading whose text starts with an optional "v" + digit,
// e.g. "# v0.5.71-Custom (2026-09-10)" or "## v0.5.65". Sub-headings like "## Features"
// are intentionally NOT treated as boundaries.
function splitVersions(md) {
  if (!md) return [];
  const lines = md.split("\n");
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^ {0,3}#{1,2}\s+(v?\d[^\n]*)$/i);
    if (m) {
      if (cur) sections.push(cur);
      cur = { title: m[1].trim(), body: "" };
    } else if (cur) {
      cur.body += line + "\n";
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

// One card per day: thirty releases on one date read as one block, not thirty borders.
function groupByReleaseDate(sections) {
 const groups = [];
 const byDate = new Map();
 for (const section of sections) {
 const date = (section.title.match(/\((\d{4}-\d{2}-\d{2})\)/) || [])[1] || section.title;
 if (!byDate.has(date)) {
 const group = { date, items: [] };
 byDate.set(date, group);
 groups.push(group);
 }
 byDate.get(date).items.push(section);
 }
 return groups;
}

function renderBody(bodyMd) {
 if (!bodyMd.trim()) return "";
 const demoted = bodyMd.replace(/^#{2,6}\s/gm, (m) => "#".repeat(Math.min(6, m.length + 2)) + " ");
 return marked.parse(demoted);
}

function renderVersionCards(md, accent) {
 const sections = splitVersions(md);
 const cardStyle = `margin:0 0 14px;padding:14px 16px;border:1px solid ${accent.border};border-radius:12px;background:${accent.bg};box-sizing:border-box;`;
 const titleStyle = `margin:0 0 10px;font-size:15px;font-weight:700;color:${accent.color};display:flex;align-items:center;gap:8px;`;
 const subStyle = `margin:16px 0 8px;font-size:13.5px;font-weight:700;color:${accent.color};opacity:.9;`;
 if (!sections.length) {
 const html = md ? marked.parse(md) : "";
 return html ? `<div style="${cardStyle}"><div class="changelog-body">${html}</div></div>` : "";
 }
 return groupByReleaseDate(sections)
 .map((group) => {
 const head = group.items.length === 1 ? group.items[0].title : `${group.date} · ${group.items.length} releases`;
 const inner = group.items.length === 1
 ? renderBody(group.items[0].body)
 : group.items
 .map((section) => `<h4 style="${subStyle}">${escapeHtml(section.title)}</h4>${renderBody(section.body)}`)
 .join("");
 return `<div style="${cardStyle}">
 <h3 style="${titleStyle}">
 <span class="material-symbols-outlined" style="font-size:18px;">${accent.icon}</span>
 ${escapeHtml(head)}
 </h3>
 <div class="changelog-body">${inner}</div>
 </div>`;
 })
 .join("");
}

const SEREN_ACCENT = {
  color: "#60a5fa",
  border: "rgba(96,165,250,0.35)",
  bg: "rgba(96,165,250,0.06)",
  icon: "star",
};
const OFFICIAL_ACCENT = {
  color: "rgba(148,163,184,0.95)",
  border: "rgba(148,163,184,0.25)",
  bg: "rgba(148,163,184,0.05)",
  icon: "history_edu",
};

export default function ChangelogModal({ isOpen, onClose }) {
  const [combinedHtml, setCombinedHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen || combinedHtml) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    loadChangelogs()
      .then(([decoluaMd, serenhopeMd]) => {
        if (cancelled) return;

        const serenCards = serenhopeMd ? renderVersionCards(serenhopeMd, SEREN_ACCENT) : "";
        const officialCards = decoluaMd ? renderVersionCards(decoluaMd, OFFICIAL_ACCENT) : "";

        const serenBlock = serenCards
          ? `<div style="display:flex;align-items:center;gap:8px;margin:0 0 14px;font-size:17px;font-weight:600;color:#60a5fa;">
  <span class="material-symbols-outlined" style="font-size:20px;">star</span>
  Contributed by Serenhope
</div>
${serenCards}`
          : "";

        const divider = serenCards && officialCards
          ? `<div style="margin:32px 0 20px 0;padding-top:24px;border-top:1px solid rgba(128,128,128,0.15);display:flex;align-items:center;gap:8px;font-size:17px;font-weight:600;color:rgba(148,163,184,0.85);">
  <span class="material-symbols-outlined" style="font-size:20px;">history_edu</span>
  Official Releases (Decolua)
</div>`
          : "";

        const officialBlock = officialCards
          ? (divider || `<div style="display:flex;align-items:center;gap:8px;margin:0 0 14px;font-size:17px;font-weight:600;color:rgba(148,163,184,0.85);">
  <span class="material-symbols-outlined" style="font-size:20px;">history_edu</span>
  Official Releases (Decolua)
</div>`) + officialCards
          : "";

        setCombinedHtml(serenBlock + officialBlock);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load changelog");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, combinedHtml]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  // Reset content when modal closes
  useEffect(() => {
    if (!isOpen) setCombinedHtml("");
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-3xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <h2 className="text-lg font-semibold text-text-main">Change Log</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 prose dark:prose-invert max-w-none text-sm">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="material-symbols-outlined text-3xl animate-spin text-primary">progress_activity</span>
            </div>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : combinedHtml ? (
            <div dangerouslySetInnerHTML={{ __html: combinedHtml }} />
          ) : (
            <p className="text-text-muted">No changelog available.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

ChangelogModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
