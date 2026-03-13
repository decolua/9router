"use client";

export default function Tooltip({ text, children, position = "top" }) {
  const posClass = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  }[position];

  return (
    <div className="relative inline-flex group">
      {children}
      <div className={`pointer-events-none absolute ${posClass} z-50 w-max max-w-56 rounded px-2 py-1 text-[11px] leading-snug bg-gray-900 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-normal`}>
        {text}
      </div>
    </div>
  );
}
