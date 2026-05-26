import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    ".next-cli-build/**",
    "build/**",
    "next-env.d.ts",
    ".agents/**",
    ".claude/**",
    "node_modules/**",
    "dist/**"
  ]),
]);

export default eslintConfig;
