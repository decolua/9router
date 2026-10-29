import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored CLI build output (Next standalone + its bundled copy).
    // `**/` is REQUIRED: flat-config ignore patterns containing a slash are
    // anchored to the config's base path, so a bare ".next-cli-build/**"
    // would leave cli/app/.next-cli-build/** and the nested
    // .next-cli-build/standalone/**/.next-cli-build/** copies in the lint
    // scope (2166 generated files — 63% of the tree — were being linted).
    ".next-cli-build/**",
    "**/.next-cli-build/**",
  ]),
]);

export default eslintConfig;
