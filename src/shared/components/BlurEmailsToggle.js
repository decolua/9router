"use client";

import { useBlurEmails } from "@/shared/hooks/useBlurEmails";
import { cn } from "@/shared/utils/cn";

// Icon artwork from Lucide (MIT) — the `eye` / `eye-off` pair, with the
// eye-off slash drawn on via stroke-dashoffset. Length of "m2 2 20 20" is
// sqrt(20² + 20²) ≈ 28.3, rounded up so the dash fully clears the path.
// Transition timing lives in globals.css (.blur-toggle-icon) so that the
// prefers-reduced-motion query can disable it — inline styles would win.
const SLASH_LENGTH = 29;

export default function BlurEmailsToggle({ className }) {
  const { isBlurred, toggleBlurEmails } = useBlurEmails();

  return (
    <button
      onClick={toggleBlurEmails}
      className={cn(
        "flex items-center justify-center size-10 rounded-full",
        "text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors",
        className
      )}
      aria-label={isBlurred ? "Show email addresses" : "Blur email addresses"}
      aria-pressed={isBlurred}
      title={isBlurred ? "Show email addresses" : "Blur email addresses"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="blur-toggle-icon block"
        style={{ width: 22, height: 22 }}
      >
        {/* Whole eye — fades out as the eye "breaks apart" */}
        <g style={{ opacity: isBlurred ? 0 : 1 }}>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </g>
        {/* Gapped eye that sits under the slash */}
        <g style={{ opacity: isBlurred ? 1 : 0 }}>
          <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
          <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
          <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
        </g>
        <path
          className="blur-toggle-slash"
          d="m2 2 20 20"
          style={{
            strokeDasharray: SLASH_LENGTH,
            strokeDashoffset: isBlurred ? 0 : SLASH_LENGTH,
          }}
        />
      </svg>
    </button>
  );
}
