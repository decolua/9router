// Claude-inspired color palette for Endpoint Proxy
// Light theme: Warm beige/cream tones
// Dark theme: Deep charcoal/brown tones

export const COLORS = {
  // Primary - Warm Coral/Terracotta (Claude-like)
  primary: {
    DEFAULT: "#D97757",
    hover: "#C56243",
    light: "#E8A58C",
    dark: "#B0664D",
  },

  // Light theme backgrounds
  light: {
    bg: "#FBF9F6",
    bgAlt: "#F5F1ED",
    surface: "#FFFFFF",
    sidebar: "rgba(246, 246, 246, 0.8)",
    border: "rgba(0, 0, 0, 0.1)",
    textMain: "#383733",
    textMuted: "#75736E",
  },

  // Dark theme backgrounds
  dark: {
    bg: "#191918",
    bgAlt: "#1F1F1E",
    surface: "#242423",
    sidebar: "rgba(30, 30, 30, 0.8)",
    border: "rgba(255, 255, 255, 0.1)",
    textMain: "#ECEBE8",
    textMuted: "#9E9D99",
  },

  // Status colors
  status: {
    success: "#22C55E",
    successLight: "#DCFCE7",
    successDark: "#166534",
    warning: "#F59E0B",
    warningLight: "#FEF3C7",
    warningDark: "#92400E",
    error: "#EF4444",
    errorLight: "#FEE2E2",
    errorDark: "#991B1B",
    info: "#3B82F6",
    infoLight: "#DBEAFE",
    infoDark: "#1E40AF",
  },
};

// CSS Variables mapping for Tailwind
export const CSS_VARIABLES = {
  light: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.light.bg,
    "--color-bg-alt": COLORS.light.bgAlt,
    "--color-surface": COLORS.light.surface,
    "--color-sidebar": COLORS.light.sidebar,
    "--color-border": COLORS.light.border,
    "--color-text-main": COLORS.light.textMain,
    "--color-text-muted": COLORS.light.textMuted,
  },
  dark: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.dark.bg,
    "--color-bg-alt": COLORS.dark.bgAlt,
    "--color-surface": COLORS.dark.surface,
    "--color-sidebar": COLORS.dark.sidebar,
    "--color-border": COLORS.dark.border,
    "--color-text-main": COLORS.dark.textMain,
    "--color-text-muted": COLORS.dark.textMuted,
  },
};
