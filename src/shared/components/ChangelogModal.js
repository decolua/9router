"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { marked } from "marked";
import { SERENHOPE_SOURCE, DECOLUA_SOURCE, DEFAULT_CHANGELOG_SOURCE, availableChangelogSources, pickChangelogSource } from "./changelogSources.js";

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

// A version's body runs until the next version heading, so it always ends with the
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
      if (cur) sections.push({ ...cur, body: stripSectionRules(cur.body) });
      cur = { title: m[1].trim(), body: "" };
    } else if (cur) {
      cur.body += line + "\n";
    }
  }
  if (cur) sections.push({ ...cur, body: stripSectionRules(cur.body) });
  return sections;
}

// One card per day: thirty releases on one date read as one block, not thirty borders.
function groupByReleaseDate(sections) {
 const groups = [];
 const byDate = new Map();
 for (const section of sections) {
 const date = (section.title.match(/\((\d{4}-\d{2}-\d{2})\)/) || [])[1] || section.title;
 const commits = (section.title.match(/·\s*(\d+)\s+commit/) || [])[1];
 if (!byDate.has(date)) {
 const group = { date, items: [] };
 byDate.set(date, group);
 groups.push(group);
 }
 byDate.get(date).items.push({ ...section, commits: commits ? Number(commits) : null });
 }
 return groups;
}

// Commits for one release: the heading when it already carries one
// ("# v0.5.154 (2026-10-03) · 21 commits"), otherwise the bullet lines in the
// body -- the changelog hook writes one bullet per commit.
function countSectionCommits(section) {
 if (section.commits != null) return section.commits;
 return countBodyCommits(section.body);
}

function countBodyCommits(body) {
 const lines = String(body || "").split("\n");
 return lines.filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
}

// Drop any existing "· N commits" so a recomputed total is never appended twice.
function stripCommitCount(title) {
 return title.replace(/\s*·\s*\d+\s+commits?\b/i, "");
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
  "whats added?": "Features",
  "what was added?": "Features",
  "what was added": "Features",
  "what was added / fixed": "Features",
  "what was fixed?": "Fixes",
  "what changed?": "Changed",
  "what's new?": "Features",
  "what's new": "Features",
  "what changed": "Changed",
  "what was changed": "Changed",
  "what was fixed": "Fixes",
  "what was removed": "Removed",
  "what was undone?": "Undone",
  "what was undone": "Undone",
  "undone": "Undone",
  "upstream sync": "Internal",
  "skipped": "Internal",
  "what was deleted?": "Removed",
  "what was replaced?": "Deprecated",
  "what was renamed?": "Deprecated",
  "what was hardened?": "Security",
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
  "upstream port completion": "Internal",
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
  Features: { verb: "Added", question: "WHAT\u2019S ADDED?", icon: "add", color: "#22c55e", tint: "rgba(34,197,94,.10)" },
  Fixes: { verb: "Fixed", question: "WHAT WAS FIXED?", icon: "check_circle", color: "#f59e0b", tint: "rgba(245,158,11,.10)" },
  Removed: { verb: "Removed", question: "WHAT WAS DELETED?", icon: "delete", color: "#f43f5e", tint: "rgba(244,63,94,.10)" },
  Deprecated: { verb: "Deprecated", question: "WHAT WAS REPLACED?", icon: "restart_alt", color: "#a855f7", tint: "rgba(168,85,247,.10)" },
  Undone: { verb: "Undone", question: "WHAT WAS UNDONE?", icon: "history", color: "#0ea5e9", tint: "rgba(14,165,233,.10)" },
  Changed: { verb: "Changed", question: "WHAT CHANGED?", icon: "edit_note", color: "#ec4899", tint: "rgba(236,72,153,.10)" },
  Performance: { verb: "Faster", question: "WHAT GOT FASTER?", icon: "bolt", color: "#06b6d4", tint: "rgba(6,182,212,.10)" },
  Security: { verb: "Hardened", question: "WHAT WAS HARDENED?", icon: "shield", color: "#ef4444", tint: "rgba(239,68,68,.10)" },
  Docs: { verb: "Documented", question: "WHAT\u2019S DOCUMENTED?", icon: "menu_book", color: "#38bdf8", tint: "rgba(56,189,248,.10)" },
  UI: { verb: "Redesigned", question: "WHAT LOOKS DIFFERENT?", icon: "palette", color: "#f97316", tint: "rgba(249,115,22,.10)" },
  Internal: { verb: "Internal", question: "WHAT\u2019S UNDER THE HOOD?", icon: "science", color: "#94a3b8", tint: "rgba(148,163,184,.10)" },
};

function categoryStyle(name) {
 const key = canonicalCategory(name);
 return (
 CATEGORY_STYLE[key] ||
 // Unknown categories still get a stable look instead of falling back to the
 // heading style that made everything blur together.
 { verb: key, question: key.toUpperCase() + "?", icon: "help", color: "#94a3b8", tint: "rgba(148,163,184,.08)" }
 );
}

// The leading verb of a bullet says what the change IS. Matching on the verb
// rather than the whole line keeps the rest of the sentence untouched.
const CHANGE_VERB = [
 { re: /^(add(ed|s)?|introduc(e|ed|es|ing)|support(ed|s)?|implement(ed|s)?|new)\b/i, kind: "Added", icon: "add", color: "#22c55e" },
 { re: /^(fix(es|ed)?|correct(s|ed)?|repair(s|ed)?|resolv(e|es|ed))\b/i, kind: "Fixed", icon: "check_circle", color: "#f59e0b" },
 { re: /^(remove[sd]?|delet(e|es|ed)|drop(s|ped)?|retire[sd]?)\b/i, kind: "Removed", icon: "delete", color: "#f43f5e" },
 { re: /^(deprecat(e|ed|es)|renam(e|ed|es)|chang(e|ed|es))\b/i, kind: "Changed", icon: "edit", color: "#a855f7" },
 { re: /^(upgrad(e|ed|es)|bump(s|ed)?|rais(e|ed|es)|increas(e|ed|es))\b/i, kind: "Changed", icon: "arrow_upward", color: "#a855f7" },
 { re: /^(secur(e|ity)|harden(s|ed)?|sign(s|ed)?|authent(icat(e|ion)))\b/i, kind: "Security", icon: "shield", color: "#ef4444" },
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
 // Heading level is kept for structure, then restyled below into a pill: the
 // parser output decides what is a category and what is a bullet.
 const html = marked.parse(demoted);

 // The demotion above moves every category to a different heading level, so
 // this matches h1..h6 rather than one level. The level is preserved on the
 // element and the visual treatment comes from the pill, so the document keeps
 // its structure while reading as a labelled category.
 let out = html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (_m, level, attrs, inner) => {
 const raw = inner.replace(/<[^>]+>/g, "").trim();
 const name = canonicalCategory(raw);
 const st = categoryStyle(raw);
 return (
 `<h${level}${attrs} class="cl-cat" data-cat="${escapeHtml(name)}" style="display:flex;align-items:center;gap:8px;margin:18px 0 10px;padding:7px 11px;border-radius:10px;border-left:3px solid ${st.color};` +
 `background:${st.tint};border:1px solid ${st.color}33;font-size:inherit;font-weight:inherit;">` +
 `<span class="material-symbols-outlined" style="font-size:16px;color:${st.color};line-height:1;">${st.icon}</span>` +
 `<span style="font-size:12.5px;font-weight:800;letter-spacing:.06em;color:${st.color};">${escapeHtml(st.question || (st.verb || name).toUpperCase())}</span>` +
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

// A merged day card concatenates several patch bodies, each carrying its own
// ## Features / ## Fixes headings. Split every body on its h2 sub-headings and
// rejoin items under one heading each, keeping the order the headings first
// appear in - so Fixes shows once with all fixes, not four times.
// Fold a category's bullets under their shared `**Scope**:` prefix and drop
// duplicates. Folding is what the reader asked for: three separate
// "- **Antigravity**: ..." lines collapse into one Antigravity heading with the
// lines beneath it. A scope is folded only when it holds two or more items, so
// a single-entry category keeps its compact one-line form.
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
 if (seen.has(bulletKey)) continue; // same-day merge repeated it
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

function mergeBodiesByCategory(bodies) {
 const order = [];
 const byCat = new Map();
 for (const body of bodies) {
 let current = null;
 for (const line of String(body || "").split("\n")) {
 const m = line.match(/^#{2,6}\s+(.+?)\s*$/);
 if (m) {
 current = canonicalCategory(m[1]);
 if (!byCat.has(current)) {
 byCat.set(current, []);
 order.push(current);
 }
 } else if (current) {
 byCat.get(current).push(line);
 }
 }
 }
 // Joining raw bodies left a blank line between them; the fold pass also
 // normalises indentation, so emit only what it produced.
 return order
 .map((cat) => `## ${cat}\n${foldCategoryByScope(byCat.get(cat))}`)
 .join("\n\n");
}

// Same treatment for a body rendered on its own: split on h2 headings, fold
// each category, rejoin. Keeps the single-release card identical in style to a
// merged one.
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

function renderVersionCards(md, accent) {
 const sections = splitVersions(md);
 const cardStyle = `margin:0 0 14px;padding:14px 16px;border:1px solid ${accent.border};border-radius:12px;background:${accent.bg};box-sizing:border-box;`;
 const titleStyle = `margin:0 0 10px;font-size:15px;font-weight:700;color:${accent.color};display:flex;align-items:center;gap:8px;`;
 const subStyle = `margin:16px 0 8px;font-size:13.5px;font-weight:700;color:${accent.color};opacity:.9;`;
 // Release card: give the version header a divider under it so each release
 // reads as its own block instead of blending into the next one.
 const headRule = `margin:0 0 2px;padding-bottom:8px;border-bottom:1px solid ${accent.border};`;
 if (!sections.length) {
 const html = md ? marked.parse(md) : "";
 return html ? `<div style="${cardStyle}"><div class="changelog-body">${html}</div></div>` : "";
 }
 return groupByReleaseDate(sections)
 .map((group) => {
 // The newest release of the day titles the merged card, so it reads like any
 // other release ("v0.5.151 (2026-09-30)") instead of a bare date rollup.
 const versionOf = (s) => ((s.title.match(/v?(\d+(?:\.\d+)+)/) || [])[1] || "");
 const sortKey = (a, b) =>
 versionOf(a).localeCompare(versionOf(b), undefined, { numeric: true });
 const newest = [...group.items].sort(sortKey).pop();
 // Every card states how many commits it carries -- a single-commit release
 // included -- so entries from before the hook wrote counts ("v0.5.140
 // (2026-09-28)") are no longer indistinguishable from bigger ones.
 let head = group.items.length === 1
 ? group.items[0].title
 : newest.title.includes("(")
 ? newest.title
 : `${newest.title} (${group.date})`;
 const commits = group.items.reduce((sum, s) => sum + countSectionCommits(s), 0);
 head = stripCommitCount(head);
 if (commits > 0) {
 head += ` · ${commits} ${commits === 1 ? "commit" : "commits"}`;
 }
 const inner = group.items.length === 1
 ? renderBody(foldBody(group.items[0].body))
 : renderBody(mergeBodiesByCategory(group.items.map((section) => section.body)));
 return `<div style="${cardStyle}">
 <h3 style="${titleStyle}${headRule}">
 <span class="material-symbols-outlined" style="font-size:18px;">${accent.icon}</span>
 ${escapeHtml(head)}
 </h3>
 <div class="changelog-body">${inner}</div>
 </div>`;
 })
 .join("");
}

function buildSection(md, source) {
  const cards = renderVersionCards(md, source.accent);
  if (!cards) return "";
  const headStyle = `display:flex;align-items:center;gap:8px;margin:0 0 14px;font-size:17px;font-weight:600;color:${source.accent.color};`;
  return `<div style="${headStyle}">
  <span class="material-symbols-outlined" style="font-size:20px;">${source.accent.icon}</span>
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
        className="absolute inset-0 backdrop-blur-md"
        style={{ backgroundColor: "var(--color-scrim)" }}
        onClick={onClose}
      />
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-border-subtle rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-3xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between gap-3 p-3 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-main">Change Log</h2>
          <div className="flex items-center gap-2">
            {available.length > 1 && (
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2">
                {available.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setActiveSource(source.id)}
                    aria-pressed={shown === source.id}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      shown === source.id
                        ? "bg-surface text-text-main shadow-sm"
                        : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 prose dark:prose-invert max-w-none text-sm">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="material-symbols-outlined text-3xl animate-spin text-primary">progress_activity</span>
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
