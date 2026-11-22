/**
 * Loading Surface Render Self-Check
 *
 * Smoke-checks the loading primitives that are actually exported by Loading.js.
 * The app uses solid theme surfaces and a spinner/skeleton system; there is no
 * separate blurred progress-card overlay.
 *
 * Run with: node src/shared/components/progressCardRenderSelfCheck.mjs
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = mkdtempSync(path.join(tmpdir(), "loading-render-"));

const w = (name, body) => {
  const p = path.join(outDir, name);
  writeFileSync(p, body, "utf8");
  return p;
};

const reactStub = w("react-stub.js", `
module.exports = {
  useState: (i) => [typeof i === "function" ? i() : i, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (fn) => fn(),
  useCallback: (fn) => fn, useRef: (i) => ({ current: i }),
  useContext: () => ({}),
  createContext: () => ({ Provider: () => null, Consumer: () => null }),
  forwardRef: (fn) => fn, memo: (fn) => fn,
  Fragment: Symbol("Fragment"), default: {}, __esModule: true,
};
`);

const jsxStub = w("jsx-runtime-stub.js", `
module.exports = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  jsxDEV: (type, props) => ({ type, props }),
  Fragment: Symbol("Fragment"), __esModule: true,
};
`);

const cnStub = w("cn-stub.js", `
module.exports = {
  cn: (...xs) => xs.filter(Boolean).join(" "),
  __esModule: true,
};
`);

function loadLoading() {
  const outfile = path.join(outDir, "Loading.cjs");
  execFileSync("npx", [
    "esbuild", path.join(here, "Loading.js"),
    "--bundle", "--format=cjs", "--platform=node",
    "--loader:.js=jsx", "--jsx=automatic",
    `--alias:react=${reactStub}`,
    `--alias:react/jsx-runtime=${jsxStub}`,
    `--alias:@/shared/utils/cn=${cnStub}`,
    "--outfile=" + outfile, "--log-level=error",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return require(outfile);
}

const { Spinner, PageLoading, Skeleton, CardSkeleton, default: Loading } = loadLoading();
const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
const assert = {
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
  no(v, msg) { if (v) throw new Error(msg || "expected falsy"); },
};

function flatten(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join("|");
  if (typeof node === "object") {
    const { type, props } = node;
    const name = typeof type === "string" ? type : (type?.name || "fn");
    const kids = props ? flatten(props.children) : "";
    const attrs = props
      ? Object.entries(props)
        .filter(([k]) => k !== "children")
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ")
      : "";
    return `<${name} ${attrs}>${kids}</${name}>`;
  }
  return "";
}

run("current loading primitives are exported", () => {
  assert.ok(typeof Spinner === "function", "Spinner export");
  assert.ok(typeof PageLoading === "function", "PageLoading export");
  assert.ok(typeof Skeleton === "function", "Skeleton export");
  assert.ok(typeof CardSkeleton === "function", "CardSkeleton export");
  assert.ok(typeof Loading === "function", "default loading dispatcher");
});

run("page loading uses a solid theme canvas without a blur layer", () => {
  const tree = flatten(PageLoading({ message: "Loading provider settings" }));
  assert.ok(tree.includes("fixed") && tree.includes("inset-0"), "fills the viewport");
  assert.ok(tree.includes("bg-bg"), "uses the theme canvas");
  assert.ok(tree.includes("Loading provider settings"), "shows its message");
  assert.no(tree.includes("backdrop-blur"), "does not use a blurred backdrop");
  assert.no(tree.includes("backdrop-filter"), "does not use a backdrop filter");
  assert.no(tree.includes("bg-black/55"), "does not use the retired dark veil");
});

run("spinner and skeleton retain their semantic content and theme surfaces", () => {
  const spinner = flatten(Spinner({ size: "lg" }));
  const skeleton = flatten(Skeleton({ className: "h-4 w-24" }));
  assert.ok((spinner.match(/loading-boxes__square/g) || []).length === 4, "four-box spinner");
  assert.ok(spinner.includes('role="status"'), "accessible loading status");
  assert.ok(spinner.includes('aria-label="Loading"'), "loading label");
  assert.ok(spinner.includes("size-8"), "large spinner size");
  assert.ok(skeleton.includes("bg-surface-2"), "skeleton surface");
  assert.ok(skeleton.includes("h-4 w-24"), "caller dimensions retained");
});

run("card skeleton still composes the expected placeholder blocks", () => {
  const tree = flatten(CardSkeleton());
  assert.ok(tree.includes("p-6"), "card padding");
  assert.ok(tree.includes("bg-surface"), "theme card surface");
  assert.ok(tree.includes("Skeleton"), "reusable skeleton children");
});

run("loading dispatcher forwards the requested page variant", () => {
  const tree = flatten(Loading({ type: "page", message: "Starting server" }));
  assert.ok(tree.includes("PageLoading"), "dispatches to page loading");
  assert.ok(tree.includes("Starting server"), "forwards message");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` - ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
