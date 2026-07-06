import { defineConfig, globalIgnores } from "eslint/config";

// Minimal flat config. The old eslint-config-next/core-web-vitals ruleset was
// removed with the Next.js dependency; vinext uses Vite, so the Next-specific
// lint rules (no-html-link-for-pages, etc.) no longer apply. Add back
// eslint-plugin-react / react-hooks here if you want React linting.
const eslintConfig = defineConfig([
  globalIgnores([
    "dist/**",
    ".next/**",
    ".vinext/**",
    "out/**",
    "build/**",
    "cli/app/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
