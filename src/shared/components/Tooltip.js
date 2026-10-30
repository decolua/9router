"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({ text, children, position = "top", color }) {
  const anchorRef = useRef(null);
  const [style, setStyle] = useState(null);

  // Render via portal + fixed positioning so overflow/scroll ancestors can't clip the bubble
  const handleMouseEnter = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    const bubbleHalfWidth = Math.min(144, (window.innerWidth - 24) / 2);
    const horizontalCenter = Math.max(12 + bubbleHalfWidth, Math.min(window.innerWidth - 12 - bubbleHalfWidth, midX));
    let pos;
    if (position === "bottom") pos = { top: rect.bottom + 6, left: horizontalCenter, transform: "translateX(-50%)" };
    else if (position === "left") pos = { right: window.innerWidth - rect.left + 6, top: midY, transform: "translateY(-50%)" };
    else if (position === "right") pos = { left: rect.right + 6, top: midY, transform: "translateY(-50%)" };
    else pos = { bottom: window.innerHeight - rect.top + 6, left: horizontalCenter, transform: "translateX(-50%)" };
    setStyle({ position: "fixed", ...pos });
  };

  return (
    <div
      ref={anchorRef}
      className="relative inline-flex"
      onFocus={handleMouseEnter}
      onBlur={() => setStyle(null)}
      onKeyDown={(event) => { if (event.key === "Escape") setStyle(null); }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setStyle(null)}
    >
      {children}
      {style && createPortal(
        <div
          role="tooltip"
          className={`pointer-events-none z-[70] w-max max-w-[min(18rem,calc(100vw-24px))] rounded-lg border border-white/10 px-3 py-2 text-xs leading-relaxed shadow-xl text-white whitespace-normal ${color ? "" : "bg-gray-900"}`}
          style={{ ...style, ...(color ? { backgroundColor: color } : {}) }}
        >
          {text}
        </div>,
        document.body
      )}
    </div>
  );
}
