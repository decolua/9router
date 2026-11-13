"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/shared/utils/cn";

// Renders through react-markdown's default pipeline: no `rehype-raw` and no
// `dangerouslySetInnerHTML`, so inline HTML in provider payloads is shown as
// text rather than mounted. This is a load-bearing security constraint.
const MARKDOWN_COMPONENTS = {
  p: ({ children }) => (
    <p className="my-1 whitespace-pre-wrap break-words leading-relaxed first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="break-words">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-1 mt-2 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-border pl-3 text-text-muted">
      {children}
    </blockquote>
  ),
  // Security constraint: markdown images must never mount a real <img> or
  // trigger a network load, so they render as metadata-only text placeholders.
  img: ({ alt, src }) => {
    const label = typeof alt === "string" && alt.trim().length > 0 ? alt : null;
    const destination = typeof src === "string" && src.length > 0 ? src : null;

    return (
      <span className="my-1 flex items-start gap-2 rounded-lg border border-dashed border-border bg-black/[0.02] p-2 text-xs text-text-muted dark:bg-white/[0.02]">
        <span className="material-symbols-outlined text-[18px] text-text-subtle">
          image
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-text-main">
            {label || "Image"}
          </span>
          {destination && (
            <span className="mt-0.5 block truncate font-mono text-[10px] text-text-subtle">
              {destination}
            </span>
          )}
          <span className="mt-0.5 block text-[10px] text-text-subtle">
            Metadata only — image is not loaded.
          </span>
        </span>
      </span>
    );
  },
  code: ({ node, className, children, ...props }) => {
    // react-markdown v9 no longer passes `inline`; block code is nested in a
    // `pre`, which we style separately, so `code` here is the inline pill.
    return (
      <code
        className={cn(
          "rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10",
          "[pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-xs",
          className
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-black/5 bg-black/[0.03] p-3 text-xs dark:border-white/5 dark:bg-white/[0.03]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
  hr: () => <hr className="my-2 border-border-subtle" />,
};

export function RequestMessageText({ text, className }) {
  if (typeof text !== "string" || text.trim().length === 0) return null;

  return (
    <div
      className={cn(
        "text-sm text-text-main break-words [&_*:first-child]:mt-0 [&_*:last-child]:mb-0",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// OpenAI tool arguments arrive as either a JSON string or an object, so a
// string payload is parsed once and re-stringified for stable, pretty output.
function stringifyStructuredValue(value) {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return value;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function RequestMessageStructured({ value, className }) {
  const formatted = stringifyStructuredValue(value);

  return (
    <pre
      className={cn(
        "overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-black/5 bg-black/[0.03] p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/[0.03]",
        className
      )}
    >
      {formatted}
    </pre>
  );
}

// Metadata-only: this component must never mount <img>/<audio>/<video> or
// trigger network loads for provider media, so only shape keys are surfaced.
function describeBlockShape(block) {
  if (!block || typeof block !== "object") return "unknown";
  const mediaType = block.media_type || block.mime_type || block.mimeType;
  if (typeof mediaType === "string" && mediaType.length > 0) return mediaType;
  if (typeof block.type === "string" && block.type.length > 0) return block.type;
  return "unknown";
}

function summarizeKeys(block) {
  if (!block || typeof block !== "object") return [];
  return Object.keys(block).filter((key) => key !== "type").slice(0, 8);
}

export function RequestMessageBlockPlaceholder({ block, className }) {
  const shape = describeBlockShape(block);
  const keys = summarizeKeys(block);
  const hasSize =
    block && typeof block === "object" && typeof block.size === "number";

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-dashed border-border bg-black/[0.02] p-3 text-xs text-text-muted dark:bg-white/[0.02]",
        className
      )}
    >
      <span className="material-symbols-outlined text-[18px] text-text-subtle">
        data_object
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-text-main">
            {block?.type === "image"
              ? "Image block"
              : block?.type === "document"
                ? "Document block"
                : "Non-text block"}
          </span>
          <span className="rounded-full border border-border-subtle px-2 py-0.5 font-mono text-[10px]">
            {shape}
          </span>
          {hasSize && (
            <span className="text-[10px] tabular-nums">
              {block.size.toLocaleString()} B
            </span>
          )}
        </div>
        {keys.length > 0 && (
          <div className="mt-1 truncate font-mono text-[10px] text-text-subtle">
            {keys.join(", ")}
          </div>
        )}
        <div className="mt-1 text-[10px] text-text-subtle">
          Metadata only — media is not loaded.
        </div>
      </div>
    </div>
  );
}

export default function RequestMessagePreview({ text }) {
  return <RequestMessageText text={text} />;
}
