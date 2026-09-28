"use client";

import { useMemo, useState } from "react";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";
import { analyzeRequestMessages } from "./requestMessageAnalysis";
import {
  RequestMessageBlockPlaceholder,
  RequestMessageStructured,
  RequestMessageText,
} from "./RequestMessagePreview";

const ROLE_BADGE_STYLES = {
  system: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  user: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  assistant: "bg-brand-500/10 text-brand-600 dark:text-brand-300",
  tool: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

const BLOCK_BADGE_STYLES = {
  text: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  tool_call: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  tool_use: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  tool_result: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

const BLOCK_LABELS = {
  text: "Text",
  tool_call: "Tool Call",
  tool_use: "Tool Use",
  tool_result: "Tool Result",
};

function roleBadgeClass(role) {
  return ROLE_BADGE_STYLES[role] || "bg-black/5 text-text-muted dark:bg-white/10";
}

function blockBadgeClass(type) {
  return BLOCK_BADGE_STYLES[type] || "bg-black/5 text-text-muted dark:bg-white/10";
}

function blockLabel(type) {
  return BLOCK_LABELS[type] || (type ? String(type) : "Block");
}

function roleLabel(role) {
  return role && role.length > 0 ? role : "unknown";
}

function BlockList({ blocks, showSource = false }) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          {block.type !== "text" && (
            <span
              className={cn(
                "inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold",
                blockBadgeClass(block.type)
              )}
            >
              {blockLabel(block.type)}
            </span>
          )}
          <BlockContent block={block} showSource={showSource} />
        </div>
      ))}
    </div>
  );
}

// Source mode renders the raw provider text verbatim: React escapes the string
// by default and there is no markdown parsing, so this can never mount HTML.
function RequestMessageSourceText({ text, className }) {
  if (typeof text !== "string" || text.trim().length === 0) return null;

  return (
    <pre
      className={cn(
        "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-main",
        className
      )}
    >
      {text}
    </pre>
  );
}

function BlockContent({ block, showSource = false }) {
  switch (block.type) {
    case "text":
      return showSource ? (
        <RequestMessageSourceText text={block.text} />
      ) : (
        <RequestMessageText text={block.text} />
      );
    case "tool_call":
      return (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs font-semibold text-text-main">
            {block.name || "unknown_tool"}
          </span>
          <RequestMessageStructured value={block.arguments} />
        </div>
      );
    case "tool_use":
      return (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs font-semibold text-text-main">
            {block.name || "unknown_tool"}
          </span>
          <RequestMessageStructured value={block.input} />
        </div>
      );
    case "tool_result":
      return (
        <div className="flex flex-col gap-1">
          {(block.toolCallId || block.toolUseId) && (
            <span className="font-mono text-[10px] text-text-subtle">
              {block.toolCallId || block.toolUseId}
            </span>
          )}
          <RequestMessageStructured value={block.content} />
        </div>
      );
    default:
      return <RequestMessageBlockPlaceholder block={block} />;
  }
}

function StatCard({ label, value, tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-black/5 bg-black/[0.02] px-3 py-2 dark:border-white/5 dark:bg-white/[0.02]">
      <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className={cn("font-mono text-sm font-semibold text-text-main", tone)}>
        {value}
      </span>
    </div>
  );
}

function SummaryStats({ stats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard label="Messages" value={stats.messageCount} />
      <StatCard label="Text blocks" value={stats.textBlockCount} />
      <StatCard label="Tool calls" value={stats.toolCallCount} />
      <StatCard label="Tool results" value={stats.toolResultCount} />
      <StatCard label="Other blocks" value={stats.nonTextBlockCount} />
    </div>
  );
}

function RoleFilter({ roleCounts, activeRole, onSelect, total }) {
  const roles = Object.keys(roleCounts);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={activeRole === "all" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onSelect("all")}
      >
        All
        <span className="font-mono text-[10px] text-text-muted">{total}</span>
      </Button>
      {roles.map((role) => (
        <Button
          key={role}
          variant={activeRole === role ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onSelect(role)}
        >
          <span className={cn("h-2 w-2 rounded-full", roleBadgeClass(role))} />
          {roleLabel(role)}
          <span className="font-mono text-[10px] text-text-muted">
            {roleCounts[role]}
          </span>
        </Button>
      ))}
    </div>
  );
}

function MessageListItem({ message, isActive, onSelect }) {
  const preview = message.blocks.find((block) => block.type === "text");
  const text = preview?.text?.trim() || "";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
        isActive
          ? "border-primary/40 bg-brand-500/[0.06]"
          : "border-black/5 bg-black/[0.02] hover:bg-black/[0.04] dark:border-white/5 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
            roleBadgeClass(message.role)
          )}
        >
          {roleLabel(message.role)}
        </span>
        <span className="font-mono text-[10px] text-text-subtle">
          #{message.index}
        </span>
      </div>
      <span className="line-clamp-2 text-xs text-text-muted">
        {text || `${message.blocks.length} structured block(s)`}
      </span>
    </button>
  );
}

export default function RequestMessageAnalysisModal({ isOpen, onClose, request }) {
  const { hasMessages, messages, stats } = useMemo(
    () => analyzeRequestMessages({ request }),
    [request]
  );

  const [activeRole, setActiveRole] = useState("all");
  const [activeIndex, setActiveIndex] = useState(null);
  // Separate flag: closing the full-window preview must not reset the
  // caller's activeRole/activeIndex (filter + message selection).
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isSourceMode, setIsSourceMode] = useState(false);

  const filteredMessages = useMemo(() => {
    if (activeRole === "all") return messages;
    return messages.filter((message) => message.role === activeRole);
  }, [messages, activeRole]);

  const defaultIndex = filteredMessages[0]?.index ?? null;
  const selectedIndex = activeIndex ?? defaultIndex;
  const selectedMessage =
    filteredMessages.find((message) => message.index === selectedIndex) ||
    filteredMessages[0] ||
    null;

  const handleRoleSelect = (role) => {
    setActiveRole(role);
    setActiveIndex(null);
  };

  // Escape/Close from fullscreen returns to analysis (keeping activeRole/activeIndex); otherwise delegate to parent.
  const handleModalClose = () => {
    if (isFullscreenOpen) {
      setIsFullscreenOpen(false);
      setIsSourceMode(false);
      return;
    }
    onClose();
  };

  const handleOpenFullscreen = () => {
    setIsSourceMode(false);
    setIsFullscreenOpen(true);
  };

  const isImmersive = isFullscreenOpen && Boolean(selectedMessage);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      title="Request message analysis"
      size="full"
      immersive={isImmersive}
      className="max-w-[min(1400px,95vw)]!"
    >
      {isImmersive ? (
        <>
          <button
            type="button"
            onClick={handleModalClose}
            className="fixed right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-surface/80 text-text-muted backdrop-blur transition-colors hover:bg-surface-2 hover:text-text-main dark:border-white/10 sm:right-6 sm:top-6"
            title="Exit full window"
            aria-label="Exit full window"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
          <button
            type="button"
            onClick={() => setIsSourceMode((current) => !current)}
            className="fixed bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-surface/80 text-text-muted backdrop-blur transition-colors hover:bg-surface-2 hover:text-text-main dark:border-white/10 sm:bottom-6 sm:right-6"
            title={isSourceMode ? "View rendered Markdown" : "View source text"}
            aria-label={isSourceMode ? "View rendered Markdown" : "View source text"}
          >
            <span className="material-symbols-outlined text-[20px]">
              {isSourceMode ? "markdown" : "code"}
            </span>
          </button>
          <div className="flex h-full flex-col overflow-y-auto custom-scrollbar">
            <div className="mx-auto w-full max-w-[78vw] px-5 pb-20 pt-8 sm:px-8">
              <BlockList
                blocks={selectedMessage.blocks}
                showSource={isSourceMode}
              />
            </div>
          </div>
        </>
      ) : !hasMessages ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-text-muted">
          <span className="material-symbols-outlined text-[28px]">
            chat_bubble
          </span>
          <p className="text-sm">No analyzable messages in this request.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <SummaryStats stats={stats} />

          <RoleFilter
            roleCounts={stats.roleCounts}
            activeRole={activeRole}
            onSelect={handleRoleSelect}
            total={stats.messageCount}
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar lg:max-h-[calc(90vh-300px)]">
              {filteredMessages.map((message) => (
                <MessageListItem
                  key={message.index}
                  message={message}
                  isActive={selectedMessage?.index === message.index}
                  onSelect={() => setActiveIndex(message.index)}
                />
              ))}
            </div>

            <div className="flex min-h-[45vh] max-h-[calc(85vh-260px)] min-w-0 flex-col rounded-lg border border-black/5 dark:border-white/5 lg:max-h-[calc(90vh-300px)]">
              {selectedMessage ? (
                <>
                  <div className="flex shrink-0 items-center gap-2 border-b border-black/5 p-4 dark:border-white/5">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        roleBadgeClass(selectedMessage.role)
                      )}
                    >
                      {roleLabel(selectedMessage.role)}
                    </span>
                    <span className="font-mono text-[10px] text-text-subtle">
                      message #{selectedMessage.index}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-text-subtle">
                      {selectedMessage.blocks.length} block(s)
                    </span>
                    <button
                      type="button"
                      onClick={handleOpenFullscreen}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-black/[0.06] hover:text-text-main dark:hover:bg-white/[0.08]"
                      title="Open message in full window"
                      aria-label="Open message in full window"
                    >
                      <span className="material-symbols-outlined text-[18px]">open_in_full</span>
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <BlockList blocks={selectedMessage.blocks} />
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center py-8 text-center text-sm text-text-muted">
                  Select a message to inspect its content.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}