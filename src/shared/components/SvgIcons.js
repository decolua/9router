"use client";

// Professional inline SVG icons — no font dependency.
// All icons use 24x24 viewBox, currentColor stroke/fill.
// Size via width/height props, color via className or currentColor.

function Svg({ size = 20, className = "", children, viewBox = "0 0 24 24", fill = "none", stroke = "currentColor", strokeWidth = 1.7, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconEye({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3.2" />
    </Svg>
  );
}

export function IconBrain({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M9.5 2a3.5 3.5 0 0 0-3.5 3.5v1A3.5 3.5 0 0 0 9.5 10h1V8.5A3.5 3.5 0 0 0 9.5 2z" />
      <path d="M14.5 2a3.5 3.5 0 0 1 3.5 3.5v1A3.5 3.5 0 0 1 14.5 10h-1V8.5A3.5 3.5 0 0 1 14.5 2z" />
      <path d="M6 7.5A3.5 3.5 0 0 0 6 14.5" />
      <path d="M18 7.5A3.5 3.5 0 0 1 18 14.5" />
      <path d="M9.5 10H14.5" />
      <path d="M9 14.5a3 3 0 0 0 6 0" />
      <path d="M12 10v4.5" />
    </Svg>
  );
}

export function IconChart({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 3 3 4-7" />
      <circle cx="7" cy="16" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="18" cy="8" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconLayers({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </Svg>
  );
}

export function IconPlug({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 2v6" />
      <path d="M8 8a4 4 0 0 1 8 0v2H8V8z" />
      <path d="M8 10h8v4a4 4 0 0 1-8 0v-4z" />
      <path d="M10 14v4" />
      <path d="M14 14v4" />
    </Svg>
  );
}

export function IconSpinner({ size = 20, className = "" }) {
  return (
    <Svg size={size} className={`${className} animate-spin`} strokeWidth={2}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Svg>
  );
}

export function IconCheck({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className} strokeWidth={2.2}>
      <path d="M5 13l4 4L19 7" />
    </Svg>
  );
}

export function IconCopy({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </Svg>
  );
}

export function IconEdit({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M11 4H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L11 15l-4 1 1-4 10.5-9.5z" />
    </Svg>
  );
}

export function IconTrash({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function IconAdd({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconClose({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className} strokeWidth={2}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  );
}

export function IconSearch({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16.5 16.5l4 4" strokeWidth={2.2} />
    </Svg>
  );
}

export function IconGavel({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M14 3l7 7-8 8-7-7 8-8z" />
      <path d="M3 21l4-4" strokeWidth={2.2} />
      <path d="M9 8l5 5" />
    </Svg>
  );
}

export function IconToggleOn({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <rect x="2" y="6" width="20" height="12" rx="6" />
      <circle cx="16" cy="12" r="3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconArrowUp({ size = 12, className = "" }) {
  return (
    <Svg size={size} className={className} strokeWidth={2.2}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Svg>
  );
}

export function IconArrowDown({ size = 12, className = "" }) {
  return (
    <Svg size={size} className={className} strokeWidth={2.2}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </Svg>
  );
}

export function IconDragHandle({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className} fill="currentColor" stroke="none">
      <circle cx="9" cy="5" r="1.6" />
      <circle cx="15" cy="5" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="15" cy="19" r="1.6" />
    </Svg>
  );
}

export function IconActivity({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M22 12h-4l-3 8-4-16-3 8H2" />
    </Svg>
  );
}

export function IconTokens({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </Svg>
  );
}

export function IconMode({ size = 16, className = "" }) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 8h10M7 12h10M7 16h10" />
    </Svg>
  );
}

// Mode badges: auto/low/high/extra styling helper
export const MODE_STYLES = {
  auto: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300",
  low: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300",
  high: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300",
  extra: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300",
  medium: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300",
  none: "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
};

// Named export for all icons map (for dynamic use)
export const Icons = {
  eye: IconEye,
  brain: IconBrain,
  chart: IconChart,
  layers: IconLayers,
  plug: IconPlug,
  spinner: IconSpinner,
  check: IconCheck,
  copy: IconCopy,
  edit: IconEdit,
  trash: IconTrash,
  add: IconAdd,
  close: IconClose,
  search: IconSearch,
  gavel: IconGavel,
  activity: IconActivity,
};

export default Icons;
