import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  {
    ignores: [
      "**/.next/**",
      "**/.next-cli-build/**",
      "**/out/**",
      "**/build/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.agents/**",
      "**/.claude/**",
      "next-env.d.ts",
    ],
  },

  ...nextVitals,
]);
