"use client";

import { useState } from "react";
import { cn } from "@/shared/utils/cn";
import {
  ROLE_STYLES, ROLE_DOT, describeAttachment, describeToolBlock,
  contentToText, extractMessages, estimateTokens, formatBytes,
} from "./chatExtract.js";



function AttachmentChips({ content }) {
  const blocks = Array.isArray(content) ? content : [content];
  const atts = blocks.filter((b) => typeof b === "object" && b !== null).map(describeAttachment).filter(Boolean);
  if (atts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-3 not-italic">
      {atts.map((att, i) => (
        <div key={i} className="inline-flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 bg-surface px-2.5 py-1.5">
          {att.kind === "image" && att.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={att.url} alt={att.label} className="h-8 w-8 rounded object-cover border border-black/10 dark:border-white/10" />
          ) : (
            <span className="material-symbols-outlined text-[18px] text-text-muted">
              {att.kind === "audio" ? "audio_file" : att.kind === "file" ? "draft" : "image"}
            </span>
          )}
          <div className="leading-tight">
            <div className="text-xs font-medium text-text-main">{att.label}</div>
            <div className="text-[10px] text-text-muted font-mono">
              {att.mime}{att.size ? ` · ${formatBytes(att.size)}` : ""}{att.uri ? " · remote" : ""}{att.fileId ? " · file_id" : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolCard({ tool, index }) {
  const [open, setOpen] = useState(false);
  if (!tool) return null;
  if (tool.kind === "calls") return <>{tool.calls.map((c, i) => <ToolCard key={i} tool={c} index={`${index}-${i}`} />)}</>;
  if (tool.kind === "call") {
    const argsJson = typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args, null, 2);
    return (
      <div className="rounded-lg border border-sky-500/25 bg-sky-500/[0.06] dark:bg-sky-400/[0.07] mb-2 overflow-hidden">
        <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
          <span className="material-symbols-outlined text-[16px] text-sky-500">build</span>
          <span className="font-sans text-xs font-semibold text-text-main">{tool.name}</span>
          <span className="text-[10px] text-text-muted font-mono truncate">{typeof tool.args === "string" && tool.argsTruncated ? tool.args : JSON.stringify(tool.args)}</span>
          <span className="material-symbols-outlined text-[16px] text-text-muted ml-auto">{open ? "expand_less" : "expand_more"}</span>
        </button>
        {open && (
          <div className="px-3 pb-2">
            {tool.id && <div className="text-[10px] text-text-muted font-mono mb-1">call_id: {tool.id}</div>}
            <pre className="overflow-auto max-h-[240px] rounded bg-black/5 dark:bg-white/5 p-2 font-mono text-[11px] text-text-main">{argsJson}</pre>
          </div>
        )}
      </div>
    );
  }
  // result
  return (
    <div className={cn("rounded-lg border mb-2 overflow-hidden", tool.isError ? "border-red-500/30 bg-red-500/[0.06]" : "border-emerald-500/25 bg-emerald-500/[0.06] dark:bg-emerald-400/[0.07]")}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className={cn("material-symbols-outlined text-[16px]", tool.isError ? "text-red-500" : "text-emerald-500")}>{tool.isError ? "error" : "check_circle"}</span>
        <span className="font-sans text-xs font-semibold text-text-main">Result{tool.name ? ` · ${tool.name}` : ""}</span>
        {tool.id && <span className="text-[10px] text-text-muted font-mono truncate">{tool.id}</span>}
        <span className="material-symbols-outlined text-[16px] text-text-muted ml-auto">{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open && (
        <div className="px-3 pb-2">
          <pre className="overflow-auto max-h-[240px] rounded bg-black/5 dark:bg-white/5 p-2 font-mono text-[11px] text-text-main whitespace-pre-wrap break-words">{tool.output}</pre>
        </div>
      )}
    </div>
  );
}

function ToolCards({ content }) {
  const blocks = Array.isArray(content) ? content : [content];
  const tools = blocks
    .filter((b) => typeof b === "object" && b !== null)
    .map(describeToolBlock)
    .filter(Boolean);
  if (tools.length === 0) return null;
  return <div className="mb-3">{tools.map((tool, i) => <ToolCard key={i} tool={tool} index={i} />)}</div>;
}

function MessageRow({ message, index, isSelected, onSelect }) {
  const role = message.role || "user";
  // OpenAI puts tool calls on the assistant message itself (tool_calls[], content often null)
  const messageTools = describeToolBlock(message);
  const text = contentToText(message.content);
  // Assistant tool_calls carry name badges; tool messages read as results
  const isToolMsg = role === "tool";
  const toolNames = messageTools?.kind === "calls"
    ? messageTools.calls.map((c) => c.name)
    : !isToolMsg && Array.isArray(message.content)
      ? message.content.map(describeToolBlock).filter((t) => t && t.kind === "call").map((t) => t.name)
      : null;
  const preview = text.split("\n")[0]
    || (toolNames?.length ? `[tool:call] ${toolNames.join(", ")}` : "")
    || (isToolMsg ? "[tool:result]" : (text ? "" : "[empty]"));
  return (
    <tr
      onClick={() => onSelect(index)}
      className={cn(
        "cursor-pointer border-b border-black/5 dark:border-white/5 transition-colors",
        isSelected ? "bg-primary/10" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      )}
    >
      <td className="w-10 px-3 py-2.5 text-xs text-text-muted font-mono">{index + 1}</td>
      <td className="w-24 px-3 py-2.5">
        <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", ROLE_STYLES[role] || ROLE_STYLES.user)}>
          {role}
        </span>
        {toolNames?.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {toolNames.map((n, i) => (
              <span key={i} className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-300">
                <span className="material-symbols-outlined text-[10px]">build</span>{n}
              </span>
            ))}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-sm text-text-main">
        <div className="max-w-full truncate">{preview}</div>
      </td>
    </tr>
  );
}

export default function PromptChatView({ request, translatedRequest, originalRequest }) {
  // "Client" is only offered for a real pristine snapshot; a present-but-empty
  // object (legacy row, failed clone) must not advertise a view it can't render.
  const hasClient = originalRequest && extractMessages(originalRequest).length > 0;
  const sources = [
    ["original", "Original"],
    ...(hasClient ? [["client", "Client"]] : []),
    ["translated", "Translated"],
  ];
  const [viewSource, setViewSource] = useState("original");
  const source = viewSource === "client" && hasClient ? originalRequest
    : viewSource === "translated" && translatedRequest ? translatedRequest
    : request;
  const messages = extractMessages(source);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [roleFilter, setRoleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  if (messages.length === 0) return null;

  const withTokens = messages.map((m, i) => ({ ...m, _index: i, _tokens: estimateTokens(contentToText(m.content)) }));
  const totalTokens = withTokens.reduce((s, m) => s + m._tokens, 0);

  const byRole = {};
  for (const m of withTokens) {
    const role = m.role || "user";
    byRole[role] ||= { count: 0, tokens: 0 };
    byRole[role].count += 1;
    byRole[role].tokens += m._tokens;
  }
  const roles = Object.keys(byRole);

  const visible = withTokens.filter((m) => {
    if (roleFilter !== "all" && (m.role || "user") !== roleFilter) return false;
    if (search && !contentToText(m.content).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Keep selection pointing at the same logical message after filtering; if it
  // was filtered out, fall back to the first visible message.
  const selected = withTokens.find((m) => m._index === selectedIndex && visible.some((v) => v._index === m._index)) || visible[0];
  const selectedPos = visible.findIndex((m) => m._index === selected?._index);
  const effectiveIndex = selectedPos >= 0 ? selected._index : visible[0]?._index;
  const selectedFinal = withTokens.find((m) => m._index === effectiveIndex);
  const selectedText = contentToText(selectedFinal?.content);
  const selectedRole = selectedFinal?.role || "user";

  const step = (dir) => {
    if (selectedPos < 0) return;
    const next = (selectedPos + dir + visible.length) % visible.length;
    setSelectedIndex(visible[next]._index);
  };

  return (
    <div className="rounded-lg border border-black/5 dark:border-white/5 overflow-hidden">
      {/* Header: prompt summary */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[18px] text-text-muted">forum</span>
          <span className="font-semibold text-sm text-text-main">Prompt</span>
          <span className="text-xs text-text-muted whitespace-nowrap">{messages.length} messages · ~{totalTokens.toLocaleString()} tokens</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {sources.length > 1 && (
            <div className="flex rounded-lg border border-black/10 dark:border-white/10 p-0.5" role="group" aria-label="Prompt source">
              {sources.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setViewSource(value)}
                  aria-pressed={viewSource === value}
                  title={value === "original"
                    ? "The captured request body (may include gateway-side rewrites that happened in place)"
                    : value === "client"
                      ? "The pristine request as the client sent it, snapshotted before any gateway mutation"
                      : "The request after translation, system-prompt rewriting and fingerprint injection"}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition-colors",
                    viewSource === value ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className={cn(
              "flex items-center gap-2 text-xs text-text-muted hover:text-text-main transition-colors whitespace-nowrap"
            )}
            aria-pressed={showRaw}
          >
            Show request body
            <span className={cn("relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition-colors", showRaw ? "bg-primary" : "bg-black/15 dark:bg-white/15")}>
              <span className={cn("inline-block h-3 w-3 rounded-full bg-white shadow transition-transform", showRaw ? "translate-x-4" : "translate-x-0.5")} />
            </span>
          </button>
        </div>
      </div>

      {/* Stats row: totals left, per-role breakdown right */}
      <div className="grid grid-cols-1 gap-4 px-4 py-3 border-b border-black/5 dark:border-white/5 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-text-muted mb-2">Tokens per message (est.)</p>
          <div className="flex h-4 w-full overflow-hidden rounded" role="img" aria-label="Token distribution per message">
            {visible.map((m) => (
              <div
                key={m._index}
                title={`#${m._index + 1} ${m.role}: ~${m._tokens} tokens`}
                className={cn("h-full border-r border-white/20 last:border-r-0", ROLE_DOT[m.role || "user"] || ROLE_DOT.user, effectiveIndex === m._index && "ring-1 ring-inset ring-black/40 dark:ring-white/50")}
                style={{ width: `${totalTokens ? (m._tokens / totalTokens) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {roles.map((role) => (
              <span key={role} className="inline-flex items-center gap-1 text-xs text-text-muted">
                <span className={cn("inline-block h-2 w-2 rounded-full", ROLE_DOT[role] || ROLE_DOT.user)} />
                {role}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-xs self-start">
          <span className="text-text-muted">Tokens</span>
          <span className="text-right font-mono text-text-main">~{totalTokens.toLocaleString()}</span>
          <span />
          {roles.map((role) => (
            <div key={role} className="contents">
              <span className="text-text-muted">By role · {role}</span>
              <span className="text-right font-mono text-text-main">{byRole[role].tokens.toLocaleString()}</span>
              <span className="text-right font-mono text-text-muted">×{byRole[role].count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Search + role filter */}
      <div className="grid grid-cols-1 gap-2 px-4 py-3 border-b border-black/5 dark:border-white/5 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages..."
            className="h-9 w-full rounded-lg border border-black/10 dark:border-white/10 bg-surface pl-8 pr-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="h-9 rounded-lg border border-black/10 dark:border-white/10 bg-surface px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
        >
          <option value="all">All roles</option>
          {roles.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
      </div>

      {showRaw ? (
        <pre className="max-h-[420px] overflow-auto bg-black/[0.03] dark:bg-white/[0.03] p-4 font-mono text-xs text-text-main">
          {JSON.stringify(source, null, 2)}
        </pre>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Message list */}
          <div className="overflow-x-auto border-b border-black/5 dark:border-white/5 lg:border-b-0 lg:border-r">
            <table className="w-full">
              <thead>
                <tr className="border-b border-black/5 dark:border-white/5 text-left text-xs text-text-muted">
                  <th className="w-10 px-3 py-2 font-medium">#</th>
                  <th className="w-24 px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Preview</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <MessageRow
                    key={m._index}
                    message={m}
                    index={m._index}
                    isSelected={effectiveIndex === m._index}
                    onSelect={setSelectedIndex}
                  />
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan="3" className="px-3 py-6 text-center text-sm text-text-muted">No messages match</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Selected message content */}
          <div className="flex min-h-[200px] flex-col">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-black/5 dark:border-white/5">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(selectedText)}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">content_copy</span> Copy
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={selectedPos <= 0}
                  className="rounded p-1 text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main disabled:opacity-30 transition-colors"
                  aria-label="Previous message"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                <span className="text-xs text-text-muted whitespace-nowrap">Message {selectedPos + 1} of {visible.length}</span>
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={selectedPos < 0 || selectedPos >= visible.length - 1}
                  className="rounded p-1 text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main disabled:opacity-30 transition-colors"
                  aria-label="Next message"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            </div>
            <div className={cn(
              "flex-1 overflow-auto max-h-[560px] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words",
              selectedRole === "system" ? "bg-violet-500/[0.04] dark:bg-violet-400/[0.05]" : "bg-transparent"
            )}>
              {Array.isArray(selectedFinal?.content) && <ToolCards content={selectedFinal.content} />}
              {!Array.isArray(selectedFinal?.content) && selectedFinal && (selectedRole === "tool" || selectedFinal.tool_calls) && <ToolCards content={[selectedFinal]} />}
              {Array.isArray(selectedFinal?.content) && <AttachmentChips content={selectedFinal.content} />}
              {selectedText || <span className="text-text-muted">[empty message]</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
