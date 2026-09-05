/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx,mdx}", "./open-sse/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "var(--color-brand-50)",
          100: "var(--color-brand-100)",
          200: "var(--color-brand-200)",
          300: "var(--color-brand-300)",
          400: "var(--color-brand-400)",
          500: "var(--color-brand-500)",
          600: "var(--color-brand-600)",
          700: "var(--color-brand-700)",
          800: "var(--color-brand-800)",
          900: "var(--color-brand-900)",
        },
        primary: "var(--color-primary)",
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
      },
      borderRadius: { brand: "var(--radius-brand)", "brand-lg": "var(--radius-brand-lg)" },
    },
  },
  darkMode: "class",
  plugins: [],
};
