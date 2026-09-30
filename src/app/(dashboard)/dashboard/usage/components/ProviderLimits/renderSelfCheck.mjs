// Render smoke-check for the Quota Tracker leaf components.
//
// Why this exists: esbuild only proves a file parses. It happily accepts a JSX
// expression that names a variable nobody ever declared, because that is
// syntactically fine — the ReferenceError only fires when the component renders.
// `resetWord` shipped that way once and took down /dashboard/quota, which has no
// error boundary. These components are pure functions of their props, so calling
// them with real-shaped data catches that whole class of bug for a few
// milliseconds and without a server.
//
// Run: node "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/renderSelfCheck.mjs"
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = mkdtempSync(path.join(tmpdir(), "quota-render-"));

// Hooks only need to return something the body can read; no DOM, no scheduler.
const reactStub = `
const noop = () => {};
module.exports = {
  useState: (initial) => [typeof initial === "function" ? initial() : initial, noop],
  useEffect: noop,
  useLayoutEffect: noop,
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  useContext: () => ({}),
  forwardRef: (fn) => fn,
  memo: (fn) => fn,
  Fragment: Symbol("Fragment"),
  __esModule: true,
};
`;
const stubPath = path.join(outDir, "react-stub.js");
writeFileSync(stubPath, reactStub, "utf8");

// The automatic JSX runtime needs its own entry; it only has to produce a tree.
const jsxRuntimeStubPath = path.join(outDir, "jsx-runtime-stub.js");
writeFileSync(jsxRuntimeStubPath, `
const make = (type) => () => ({ type });
module.exports = {
  jsx: make("jsx"),
  jsxs: make("jsxs"),
  jsxDEV: make("jsx"),
  Fragment: Symbol("Fragment"),
  __esModule: true,
};
`, "utf8");

// propTypes declarations run at import time and the real package is not resolvable
// outside Next's bundler, but nothing here depends on their output.
const propTypesStubPath = path.join(outDir, "prop-types-stub.js");
writeFileSync(propTypesStubPath, `
const chain = { __esModule: true };
for (const name of ["string", "number", "bool", "func", "object", "array", "node", "element", "any", "instanceOf", "oneOf", "oneOfType", "arrayOf", "objectOf", "shape", "exact", "symbol", "bigint"]) {
  chain[name] = () => null;
}
chain.checkPropTypes = () => {};
chain.PropTypes = chain;
chain.default = chain;
module.exports = chain;
`, "utf8");

function loadComponent(file) {
  const outfile = path.join(outDir, path.basename(file).replace(/\.js$/, ".cjs"));
  execFileSync("npx", [
    "esbuild", path.join(here, file),
    "--bundle",
    "--format=cjs",
    "--platform=node",
    "--loader:.js=jsx",
    "--jsx=automatic",
    // Same aliases jsconfig.json declares, so the component's own imports resolve.
    `--alias:@=${path.resolve(here, "../../../../../../..")}/src`,
    `--alias:open-sse=${path.resolve(here, "../../../../../../..")}/open-sse`,
    `--alias:react=${stubPath}`,
    `--alias:react/jsx-runtime=${jsxRuntimeStubPath}`,
    `--alias:prop-types=${propTypesStubPath}`,
    `--outfile=${outfile}`,
    "--log-level=error",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return require(outfile);
}

const nowPlus = (ms) => new Date(Date.now() + ms).toISOString();

// One row of every shape the component branches on: plain quota, unlimited,
// credit balance, one-shot pack (recurring:false), and enough rows to paginate.
const QUOTAS = [
  { name: "Claude Pro", used: 120, total: 200, resetAt: nowPlus(3 * 3600 * 1000) },
  { name: "Claude Max", used: 400, total: 400, unlimited: true, resetAt: null },
  { name: "OpenAI Credits", used: 4.25, total: 20, isCreditBalance: true, currency: "USD", resetAt: null },
  { name: "CodeBuddy Bonus", used: 10, total: 50, recurring: false, resetAt: nowPlus(2 * 86400 * 1000) },
  { name: "No Reset Info", used: 1, total: 10, resetAt: null },
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `Filler ${i}`,
    used: i,
    total: 100,
    resetAt: nowPlus(i * 3600 * 1000),
  })),
];

const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}

const QuotaTable = loadComponent("QuotaTable.js").default;
const QuotaProgressBar = loadComponent("QuotaProgressBar.js").default;
const ProviderLimitCard = loadComponent("ProviderLimitCard.js").default;

run("QuotaTable renders a full page of quota rows", () => {
  QuotaTable({ quotas: QUOTAS, onHideQuota: () => {} });
});

run("QuotaTable renders in compact mode", () => {
  QuotaTable({ quotas: QUOTAS, compact: true, showSortLabel: true, onHideQuota: () => {} });
});

run("QuotaTable renders each sort mode", () => {
  for (const sortMode of ["default", "remaining", "used", "name", "reset"]) {
    QuotaTable({ quotas: QUOTAS, sortMode });
  }
});

run("QuotaTable renders a single row", () => {
  QuotaTable({ quotas: [QUOTAS[0]] });
});

run("QuotaTable returns null with no rows instead of throwing", () => {
  const out = QuotaTable({ quotas: [] });
  if (out !== null) throw new Error("expected null for an empty list");
});

run("QuotaProgressBar renders every percentage band", () => {
  for (const percentage of [100, 70, 30, 0, -5]) {
    QuotaProgressBar({ percentage, label: "Claude Pro", used: 1, total: 2 });
  }
});

run("QuotaProgressBar renders a one-shot pack", () => {
  QuotaProgressBar({
    percentage: 20,
    label: "Bonus Pack",
    used: 40,
    total: 50,
    recurring: false,
    resetTime: nowPlus(86400 * 1000),
  });
});

run("QuotaProgressBar renders unlimited with no reset time", () => {
  QuotaProgressBar({ percentage: 0, label: "Unlimited", used: 900, total: 0, unlimited: true, resetTime: null });
});

run("ProviderLimitCard renders a card with quotas", () => {
  ProviderLimitCard({
    provider: "claude",
    name: "Claude Pro",
    plan: "pro",
    quotas: [QUOTAS[0], QUOTAS[3]],
  });
});

run("ProviderLimitCard renders each plan variant", () => {
  for (const plan of ["free", "pro", "ultra", "enterprise", "unknown-plan"]) {
    ProviderLimitCard({ provider: "claude", name: "Claude", plan, quotas: [QUOTAS[0]] });
  }
});

run("ProviderLimitCard renders the error and loading states", () => {
  ProviderLimitCard({ provider: "codex", name: "Codex", loading: true });
  ProviderLimitCard({ provider: "codex", name: "Codex", error: "Could not reach provider" });
  ProviderLimitCard({ provider: "codex", name: "Codex", message: "Signed in as someone@example.com" });
});

run("ProviderLimitCard renders with no quotas and no props at all", () => {
  ProviderLimitCard({ provider: "kimi", name: "Kimi" });
  ProviderLimitCard({});
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
