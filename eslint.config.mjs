import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-cli-build/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `cli/app` is a generated standalone copy of `src` used by the npm
    // package. Linting it doubles the work and can time out without checking
    // any source of truth.
    "cli/app/**",
  ]),
  // These React Compiler diagnostics expose a large pre-existing migration
  // backlog. Keep them visible without turning the production lint gate into
  // a false binary failure; rules-of-hooks remains an error.
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
