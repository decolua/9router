"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { marked } from "marked";
import { SERENHOPE_SOURCE, DECOLUA_SOURCE, DEFAULT_CHANGELOG_SOURCE, availableChangelogSources, pickChangelogSource } from "./changelogSources.js";
import { commitMetadataForTitle, formatVersionDate, hideProductReleaseNumbers } from "./changelogVersionMetadata.js";

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

// A release entry's body runs until the next release heading, so it always ends with the
// `---` rule that separates versions in the file. marked turns a rule into an <hr>,
// which drew a stray line at the bottom of a card. Only entries whose rule had a blank
// line before it showed it: Markdown reads a `---` glued to the previous line as a
// setext heading underline, so the rest of the file silently swallowed its rule. Strip
// the rules here, where line boundaries are still known, and leave `---` inside fenced
// code alone -- a changelog entry may quote one.
function stripSectionRules(body) {
  const kept = [];
  let fenced = false;
  let prevBlank = true;
  for (const line of String(body || "").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^\s*-{3,}\s*$/.test(line)) continue;
    // Removing a rule between two paragraphs would otherwise leave two blank lines.
    const blank = !line.trim();
    if (!fenced && blank && prevBlank) continue;
    kept.push(line);
    prevBlank = blank;
  }
  return kept.join("\n").replace(/\s+$/, "");
}

// Split markdown into per-release sections. Boundaries are version headings from
// upstream sources or date headings from the local changelog. Category sub-headings
// such as "## Features" are intentionally NOT treated as boundaries.
function splitVersions(md) {
  if (!md) return [];
  const lines = md.split("\n");
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^ {0,3}#{1,2}\s+((?:v?\d+(?:\.\d+)+[^\n]*|\d{4}-\d{2}-\d{2}\b[^\n]*|\d{2}-\d{2}-\d{4}\b[^\n]*))$/i);
    if (m) {
      if (cur) sections.push({ ...cur, body: stripSectionRules(cur.body) });
      cur = { title: m[1].trim(), body: "" };
    } else if (cur) {
      cur.body += line + "\n";
    }
  }
  if (cur) sections.push({ ...cur, body: stripSectionRules(cur.body) });
  return sections;
}

// How each changelog category reads at a glance. `verb` is the label shown in
// the pill; `icon` is the material symbol. Colors are inline because the card
// is rendered as an HTML string, outside the Tailwind tree.
// One entry per MEANING, not per spelling. CHANGELOG.md carries 15 distinct
// headings for 7 ideas (measured), so the aliases below collapse synonyms into a
// single heading before the merge runs.
const CATEGORY_ALIAS = {
 features: "Features",
 improvements: "Features",
 changes: "Features",
 enhancements: "Features",
 "custom features & enhancements": "Features",
 "fixes & enhancements": "Fixes",
 fixes: "Fixes",
 security: "Security",
 removals: "Removed",
 removed: "Removed",
 "breaking changes": "Removed",
 deprecated: "Deprecated",
 deprecations: "Deprecated",
 renames: "Deprecated",
 "bug fixes": "Fixes",
  "bugfixes": "Fixes",
  changed: "Changed",
  refactors: "Changed",
  refactoring: "Changed",
  "behavior changes": "Changed",
  "behaviour changes": "Changed",
  performance: "Performance",
  perf: "Performance",
  "performance improvements": "Performance",
  optimization: "Performance",
  optimizations: "Performance",
  ui: "UI",
  "ui/ux": "UI",
  "ui & ux": "UI",
  "ui changes": "UI",
  styling: "UI",
  style: "UI",
  design: "UI",
  accessibility: "UI",
  a11y: "UI",
  "what's added?": "Features",
  "what's updated": "Features",
  "whats updated": "Features",
  "whats added?": "Features",
  "what was added?": "Features",
  "what was added": "Features",
  "what was added / fixed": "Features",
  "what's fixed": "Fixes",
  "whats fixed": "Fixes",
  "what was fixed?": "Fixes",
  "what got fixed?": "Fixes",
  "what changed?": "Changed",
  "what's changed": "Changed",
  "what's changed?": "Changed",
  "what's new?": "Features",
  "what's new": "Features",
  "what changed": "Changed",
  "what was changed": "Changed",
  "what was fixed": "Fixes",
  "what was removed": "Removed",
  "what's removed": "Removed",
  "what's removed?": "Removed",
  "what was undone?": "Undone",
  "what was undone": "Undone",
  "what's undone": "Undone",
  "what's undone?": "Undone",
  "undone": "Undone",
  "upstream sync": "Internal",
  "skipped": "Internal",
  "what was deleted?": "Removed",
  "what was replaced?": "Deprecated",
  "what was renamed?": "Deprecated",
  "what was hardened?": "Security",
  "what's hardened": "Security",
  "what's hardened?": "Security",
  "what's documented?": "Docs",
  "what was documented?": "Docs",
  "what's under the hood?": "Internal",
  "what got faster?": "Performance",
  "what looks different?": "UI",
  docs: "Docs",
  documentation: "Docs",
  internal: "Internal",
  notes: "Internal",
  tests: "Internal",
  refactor: "Internal",
  "documentation & maintenance": "Docs",
  "features & cleanup": "Features",
  "features & improvements": "Features",
  "providers & features": "Features",
  "providers & ui": "UI",
  "providers & usage fixes": "Fixes",
  "providers & web cookie": "Features",
  "providers & infrastructure": "Internal",
  testing: "Internal",
  "ui & theme system": "UI",
  "ui & visual design": "UI",
  "changelog ui": "UI",
  "changelog ui: composite category headings now render in colour": "UI",
  "background loading-in-the-bell": "Features",
  "background loading-in-the-bell: all surfaces verified, stale tests fixed": "Features",
  "codebuddy intl oauth login fix": "Fixes",
  "codebuddy intl oauth login fix, 4 upstream prs ported, kimi code cli setup": "Features",
  "cli tools dashboard": "UI",
  "cli tools dashboard - richer setup cards": "UI",
  "cli tools provider logos": "UI",
  "cli tools provider logos - uniform, larger, no background tint": "UI",
  "provider logos": "UI",
  "provider logos - transparent backgrounds, uniform size, 9router + llmtr marks": "UI",
  "9router sidebar logo": "UI",
  "9router sidebar logo - replaced with the new brand mark": "UI",
  "runcrate": "UI",
  "runcrate - real logo instead of the rc text tile": "UI",
  "cli tools logo tiles": "UI",
  "cli tools logo tiles - transparent background, logo only": "UI",
  "upstream feature port": "Internal",
  "upstream feature port (decolua/9router)": "Internal",
  "upstream port completion": "Internal",
  "upstream port completion (decolua/9router)": "Internal",
  "upstream feature port (decolua/9router v0.5.112)": "Internal",
  "upstream port completion (decolua/9router v0.5.112)": "Internal",
  "opencode free lane divergence clean-up": "Internal",
  "opencode free lane divergence clean-up (post-v0.5.112 port)": "Internal",
};

// "Sync with upstream v0.5.86" is a release note, not a change kind. Without
// this it became a 7th category that looked like a change section.
function canonicalCategory(name) {
 const key = String(name || "").trim();
 if (!key) return "";
 if (/^sync with upstream\b/i.test(key)) return "Internal";
 const flat = key.toLowerCase().replace(/[\u2010-\u2015\-]+/g, "-").replace(/\s*&\s*/g, " & ");
 // A trailing "?"/"!" is punctuation, not part of the category name: "What Was
 // Added" and "What Was Added?" name the same category. Probe the stripped form
 // first so a heading written without the question mark still resolves to its
 // colour instead of falling through to the gray unknown-category style.
 const probe = flat.replace(/[?!.]+$/, "").trim();
 return CATEGORY_ALIAS[probe] || CATEGORY_ALIAS[flat] || CATEGORY_ALIAS[key.toLowerCase()] || probe || key;
}

const CATEGORY_STYLE = {
  Features: { verb: "Added", question: "WHAT\u2019S ADDED?", icon: "playlist_add", color: "#22c55e", tint: "rgba(34,197,94,.10)" },
  Fixes: { verb: "Fixed", question: "WHAT WAS FIXED?", icon: "task_alt", color: "#f59e0b", tint: "rgba(245,158,11,.10)" },
  Removed: { verb: "Removed", question: "WHAT WAS DELETED?", icon: "delete_sweep", color: "#f43f5e", tint: "rgba(244,63,94,.10)" },
  Deprecated: { verb: "Deprecated", question: "WHAT WAS REPLACED?", icon: "swap_horiz", color: "#a855f7", tint: "rgba(168,85,247,.10)" },
  Undone: { verb: "Undone", question: "WHAT WAS UNDONE?", icon: "history_toggle_off", color: "#0ea5e9", tint: "rgba(14,165,233,.10)" },
  Changed: { verb: "Changed", question: "WHAT CHANGED?", icon: "rate_review", color: "#ec4899", tint: "rgba(236,72,153,.10)" },
  Performance: { verb: "Faster", question: "WHAT GOT FASTER?", icon: "speed", color: "#06b6d4", tint: "rgba(6,182,212,.10)" },
  Security: { verb: "Hardened", question: "WHAT WAS HARDENED?", icon: "verified_user", color: "#ef4444", tint: "rgba(239,68,68,.10)" },
  Docs: { verb: "Documented", question: "WHAT\u2019S DOCUMENTED?", icon: "library_books", color: "#38bdf8", tint: "rgba(56,189,248,.10)" },
  UI: { verb: "Redesigned", question: "WHAT LOOKS DIFFERENT?", icon: "tune", color: "#f97316", tint: "rgba(249,115,22,.10)" },
  Internal: { verb: "Internal", question: "WHAT\u2019S UNDER THE HOOD?", icon: "experiment", color: "#94a3b8", tint: "rgba(148,163,184,.10)" },
};

function categoryStyle(name) {
 const key = canonicalCategory(name);
 const questions = {
 Features: "WHAT'S ADDED?",
	 Fixes: "WHAT'S FIXED?",
	 Removed: "WHAT'S REMOVED?",
	 Deprecated: "WHAT'S DEPRECATED?",
	 Undone: "WHAT'S UNDONE?",
	 Changed: "WHAT'S CHANGED?",
	 Performance: "WHAT'S FASTER?",
	 Security: "WHAT'S HARDENED?",
	 Docs: "WHAT'S DOCUMENTED?",
	 UI: "WHAT'S ADDED?",
	 Internal: "WHAT'S UNDER THE HOOD?",
	 };
	 // Unknown categories still get a stable look and follow the same question form.
 const style = CATEGORY_STYLE[key] || { verb: key, icon: "help_center", color: "#94a3b8", tint: "rgba(148,163,184,.08)" };
 const question = questions[key] || `WHAT'S ${key.toUpperCase().replace(/[?!.]+$/, "")}?`;
 return { ...style, question };
}

// The leading verb of a bullet says what the change IS. Matching on the verb
// rather than the whole line keeps the rest of the sentence untouched.
const CHANGE_VERB = [
 { re: /^(add(ed|s)?|introduc(e|ed|es|ing)|support(ed|s)?|implement(ed|s)?|new)\b/i, kind: "Added", icon: "playlist_add", color: "#22c55e" },
 { re: /^(fix(es|ed)?|correct(s|ed)?|repair(s|ed)?|resolv(e|es|ed))\b/i, kind: "Fixed", icon: "task_alt", color: "#f59e0b" },
 { re: /^(remove[sd]?|delet(e|es|ed)|drop(s|ped)?|retire[sd]?)\b/i, kind: "Removed", icon: "delete_sweep", color: "#f43f5e" },
 { re: /^(deprecat(e|ed|es)|renam(e|ed|es)|chang(e|ed|es))\b/i, kind: "Changed", icon: "draw", color: "#a855f7" },
 { re: /^(upgrad(e|ed|es)|bump(s|ed)?|rais(e|ed|es)|increas(e|ed|es))\b/i, kind: "Changed", icon: "trending_up", color: "#a855f7" },
 { re: /^(secur(e|ity)|harden(s|ed)?|sign(s|ed)?|authent(icat(e|ion)))\b/i, kind: "Security", icon: "verified_user", color: "#ef4444" },
];

function changeKind(text) {
 const t = String(text || "").trim();
 if (!t) return null;
 // Folded lines already lost their bullet; the scope heading is handled apart.
 if (t.startsWith("**")) return null;
 for (const v of CHANGE_VERB) {
 if (v.re.test(t)) return v;
 }
 return null;
}

function renderBody(bodyMd) {
 if (!bodyMd.trim()) return "";
 const demoted = bodyMd.replace(/^#{2,6}\s/gm, (m) => "#".repeat(Math.min(6, m.length + 2)) + " ");
 // Heading level is kept for structure, then restyled below into a boxed label: the
 // parser output decides what is a category and what is a bullet.
 const html = marked.parse(demoted);

 // The demotion above moves every category to a different heading level, so
 // this matches h1..h6 rather than one level. The level is preserved on the
 // element and the visual treatment comes from the boxed label, so the document
 // keeps its structure while reading as a labelled category.
 let out = html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (_m, level, attrs, inner) => {
  const raw = inner.replace(/<[^>]+>/g, "").trim();
  const name = canonicalCategory(raw);
  const st = categoryStyle(raw);
  return (
  `<h${level}${attrs} class="cl-cat" data-cat="${escapeHtml(name)}" style="display:flex;align-items:center;gap:8px;margin:18px 0 12px;padding:7px 11px;border:2px solid #191817;border-radius:3px;` +
  `background:#ffd45c;box-shadow:3px 3px 0 #191817;font-size:inherit;font-weight:inherit;">` +
  `<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;color:#191817;line-height:1;">${st.icon}</span>` +
  `<span style="font-size:12px;font-weight:850;letter-spacing:.035em;color:#191817;">${escapeHtml(st.question || (st.verb || name).toUpperCase())}</span>` +
  `</h${level}>`
  );
  });

 // Each bullet gets its change-kind icon, so add / fix / remove are separable
 // without reading the sentence.
 out = out.replace(/<li>([\s\S]*?)<\/li>/g, (m, inner) => {
 const text = inner.replace(/<[^>]+>/g, "").trim();
 const v = changeKind(text);
 if (!v) return m;
 return (
 `<li style="position:relative;list-style:none;margin:0 0 6px;padding-left:24px;">` +
 `<span class="material-symbols-outlined" style="position:absolute;left:2px;top:1px;font-size:15px;color:${v.color};line-height:1.4;">${v.icon}</span>` +
 inner +
 `</li>`
 );
 });

 return out;
}

// Fold each version's category bullets under their shared `**Scope**:` prefix
// and drop duplicate lines. Three separate "- **Antigravity**: ..." lines
// collapse into one Antigravity heading with the changes beneath it.
const SCOPE_BULLET = /^[-*]\s+\*\*(.+?)\*\*\s*:\s*(.*)$/;

function foldCategoryByScope(rawLines) {
 const lines = (rawLines || []).filter((l) => l.trim() !== "");
 const seen = new Set();
 const kept = [];
 for (const line of lines) {
 const key = line.trim().replace(/\s+/g, " ");
 // Bullet identity ignores the list marker and case, so the same sentence
 // arriving with a different marker is still one entry, not two.
 const bulletKey = key.startsWith("-") || key.startsWith("*")
 ? key.replace(/^[-*]\s*/, "").toLowerCase()
 : null;
 if (bulletKey) {
 if (seen.has(bulletKey)) continue; // skip duplicate changelog bullets
 seen.add(bulletKey);
 }
 kept.push(line);
 }

 const out = [];
 const done = new Set();
 let i = 0;
 while (i < kept.length) {
 const line = kept[i];
 const m = line.match(SCOPE_BULLET);
 if (!m) { out.push(line); i++; continue; }
 const scope = m[1].trim();
 if (done.has(scope)) { i++; continue; } // already emitted at first sight
 done.add(scope);

 // Sweep the whole category for this scope so the heading stays grouped even
 // when another scope appeared in between.
 const items = [];
 for (let j = 0; j < kept.length; j++) {
 const k = kept[j].match(SCOPE_BULLET);
 if (k && k[1].trim() === scope) {
 const text = k[2].trim();
 if (text && !items.some((t) => t.toLowerCase() === text.toLowerCase())) {
 items.push(text);
 }
 }
 }
 // Every scope folds, not only the ones with two or more items. Promoting
 // Antigravity to a heading while Bedrock stayed a one-liner produced two
 // visual languages in one list, which is what made the section look unravelled.
 // A blank line before each heading (except the first) keeps the uniform result
 // from becoming a wall of text instead.
 if (items.length) {
 if (out.length) out.push("");
 out.push(`**${scope}:**`);
 for (const text of items) out.push(`- ${text}`);
 }
 i++;
 }
 return out.join("\n");
}

// Fold one release body by its h2 headings, keeping categories readable while
// each version remains its own card.
function foldBody(bodyMd) {
 const order = [];
 const byCat = new Map();
 let plain = [];
 for (const line of String(bodyMd || "").split("\n")) {
 const m = line.match(/^#{2,6}\s+(.+?)\s*$/);
 if (m) {
 const cat = canonicalCategory(m[1]);
 if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
 } else if (order.length) {
 byCat.get(order[order.length - 1]).push(line);
 } else {
 plain.push(line);
 }
 }
 const parts = [];
 const head = plain.join("\n").trim();
 if (head) parts.push(head);
 for (const cat of order) parts.push(`## ${cat}\n${foldCategoryByScope(byCat.get(cat))}`);
 return parts.join("\n\n");
}

function renderVersionCards(md, accent, sourceId) {
 const sections = splitVersions(md);
 const titles = sections.map((section) => section.title);
 const cardStyle = `margin:0 0 16px;padding:0;border:2px solid ${accent.border};border-radius:3px;background:#fffdf8;box-shadow:5px 5px 0 #191817;box-sizing:border-box;overflow:hidden;`;
 const titleStyle = `margin:0;padding:12px 14px;border-bottom:2px solid #191817;background:${accent.bg};font-size:15px;font-weight:800;color:${accent.color};display:flex;align-items:flex-start;gap:10px;`;
 const bodyStyle = "padding:12px 14px 14px;";
 if (!sections.length) {
  const html = md ? marked.parse(md) : "";
  return html ? `<div style="${cardStyle}"><div class="changelog-body" style="${bodyStyle}">${html}</div></div>` : "";
 }
 return sections
 .map((section) => {
  const commitMetadata = sourceId === SERENHOPE_SOURCE.id ? commitMetadataForTitle(section.title) : null;
  const releaseDate = formatVersionDate(section.title, commitMetadata?.committedAt || "");
  const head = releaseDate || "Date unavailable";
  const inner = renderBody(foldBody(hideProductReleaseNumbers(section.body, titles)));
  return `<div style="${cardStyle}">
 <h3 style="${titleStyle}">
  <span class="material-symbols-outlined" aria-hidden="true" style="font-size:18px;line-height:1.2;flex-shrink:0;">${accent.icon}</span>
  <span style="min-width:0;flex:1;display:flex;flex-direction:column;gap:5px;">
  <span style="font-size:16px;font-weight:850;line-height:1.2;overflow-wrap:anywhere;">${escapeHtml(head)}</span>
  </span>
  </h3>
 <div class="changelog-body" style="${bodyStyle}">${inner}</div>
 </div>`;
 })
 .join("");
}

function buildSection(md, source) {
  const cards = renderVersionCards(md, source.accent, source.id);
  if (!cards) return "";
  const headStyle = `display:inline-flex;align-items:center;gap:8px;margin:0 0 14px;padding:8px 11px;border:2px solid #191817;border-radius:3px;background:${source.accent.bg};box-shadow:3px 3px 0 #191817;font-size:14px;font-weight:800;color:${source.accent.color};`;
  return `<div style="${headStyle}">
  <span class="material-symbols-outlined" aria-hidden="true" style="font-size:20px;">${source.accent.icon}</span>
  ${escapeHtml(source.heading)}
</div>
${cards}`;
}

export default function ChangelogModal({ isOpen, onClose }) {
  const [htmlBySource, setHtmlBySource] = useState({ serenhope: "", decolua: "" });
  const [loaded, setLoaded] = useState(false);
  const [activeSource, setActiveSource] = useState(DEFAULT_CHANGELOG_SOURCE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen || loaded) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    loadChangelogs()
      .then(([decoluaMd, serenhopeMd]) => {
        if (cancelled) return;
        setHtmlBySource({
          serenhope: buildSection(serenhopeMd, SERENHOPE_SOURCE),
          decolua: buildSection(decoluaMd, DECOLUA_SOURCE),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load changelog");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      });

    return () => { cancelled = true; };
  }, [isOpen, loaded]);

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset content when modal closes
  useEffect(() => {
    if (isOpen) return;
    setHtmlBySource({ serenhope: "", decolua: "" });
    setLoaded(false);
    setActiveSource(DEFAULT_CHANGELOG_SOURCE);
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  // Only offer a tab for a source that actually has content, and never leave
  // the active tab pointing at an empty one.
  const available = availableChangelogSources(htmlBySource);
  const shown = pickChangelogSource(htmlBySource, activeSource);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 "
        style={{ backgroundColor: "var(--color-scrim)" }}
        onClick={onClose}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-modal-title"
        className="changelog-dialog relative w-full bg-surface border-2 border-text-main rounded-[3px] shadow-[8px_8px_0_var(--neo-ink)] max-w-3xl flex flex-col max-h-[85vh] overflow-hidden"
      >
        <div className="changelog-header flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4 border-b-2 border-text-main bg-[var(--neo-paper)]">
          <h2 id="changelog-modal-title" className="text-lg sm:text-xl font-extrabold text-text-main">Change Log</h2>
          <div className="flex items-center gap-2">
            {available.length > 1 && (
              <div className="changelog-source-switcher flex flex-wrap items-center gap-2" role="group" aria-label="Changelog source">
                {available.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setActiveSource(source.id)}
                    aria-pressed={shown === source.id}
                    className={`changelog-source-button min-h-11 px-3 py-2 border-2 border-text-main rounded-[3px] text-xs font-bold transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700 ${
                      shown === source.id
                        ? "bg-[#c8ee68] text-[#191817] shadow-[3px_3px_0_var(--neo-ink)]"
                        : "bg-surface text-text-main shadow-[2px_2px_0_var(--neo-ink)] hover:bg-[#ffd45c]"
                    }`}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close changelog"
              className="changelog-close size-11 inline-flex shrink-0 items-center justify-center border-2 border-text-main rounded-[3px] bg-[#ff7657] text-[#191817] shadow-[3px_3px_0_var(--neo-ink)] cursor-pointer hover:bg-[#ffd45c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">cancel</span>
            </button>
          </div>
        </div>

        <div className="changelog-content p-3 sm:p-5 overflow-y-auto flex-1 prose dark:prose-invert max-w-none text-sm bg-[var(--neo-paper)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="material-symbols-outlined text-3xl animate-spin text-primary">autorenew</span>
            </div>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : htmlBySource[shown] ? (
            <div dangerouslySetInnerHTML={{ __html: htmlBySource[shown] }} />
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
