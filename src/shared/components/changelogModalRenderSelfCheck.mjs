// Render smoke-check for the Change Log modal.
//
// Why this exists: esbuild only proves a file parses. The switcher is a list
// built with a filter and a fallback, so a renamed variable inside it parses
// fine and throws only when the modal opens — which is a blank changelog for
// everyone, with no other place that would surface it.
//
// The state is fed through a queue so the loaded, populated case is actually
// rendered: with the default empty state the switcher never appears, and a
// check that only ever renders the empty state would pass against a broken one.
//
// Run: node src/shared/components/changelogModalRenderSelfCheck.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outDir = mkdtempSync(path.join(tmpdir(), "changelog-render-"));

// The component guards on `typeof document` and portals into document.body.
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {} };

const w = (name, body) => {
  const p = path.join(outDir, name);
  writeFileSync(p, body, "utf8");
  return p;
};

const reactStub = w("react-stub.js", `
const noop = () => {};
const initialOf = (initial) => (typeof initial === "function" ? initial() : initial);
module.exports = {
  useState: (initial) => {
    const queue = globalThis.__STATE_QUEUE;
    if (Array.isArray(queue) && queue.length) return [queue.shift(), noop];
    return [initialOf(initial), noop];
  },
  useEffect: noop,
  useLayoutEffect: noop,
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  useContext: () => ({}),
  createContext: () => ({ Provider: () => null, Consumer: () => null }),
  forwardRef: (fn) => fn,
  memo: (fn) => fn,
  Fragment: Symbol("Fragment"),
  default: {},
  __esModule: true,
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

const reactDomStub = w("react-dom-stub.js", `
module.exports = { createPortal: (node) => node, __esModule: true };
`);

const propTypesStub = w("prop-types-stub.js", `
const chain = { __esModule: true };
for (const n of ["string","number","bool","func","object","array","node","element","any","instanceOf","oneOf","oneOfType","arrayOf","objectOf","shape","exact"]) {
  // Returns the chain, not null: real propTypes compose, e.g.
  // PropTypes.oneOf([...]).isRequired, and a null here breaks module load.
  chain[n] = () => chain;
  chain[n].isRequired = chain[n];
}
chain.checkPropTypes = () => {}; chain.PropTypes = chain; chain.default = chain;
module.exports = chain;
`);

const markedStub = w("marked-stub.js", `
const marked = {
  setOptions: () => {},
  parse: (md) => "<rendered>" + String(md).length + "</rendered>",
};
module.exports = { marked, __esModule: true };
`);

function loadModal() {
  const outfile = path.join(outDir, "ChangelogModal.cjs");
  execFileSync("npx", [
    "esbuild", path.join(here, "ChangelogModal.js"),
    "--bundle", "--format=cjs", "--platform=node",
    "--loader:.js=jsx", "--jsx=automatic",
    `--alias:react=${reactStub}`,
    `--alias:react/jsx-runtime=${jsxStub}`,
    `--alias:react-dom=${reactDomStub}`,
    `--alias:prop-types=${propTypesStub}`,
    `--alias:marked=${markedStub}`,
    `--outfile=${outfile}`, "--log-level=error",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return require(outfile).default;
}

const ChangelogModal = loadModal();

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
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
  no(v, msg) { if (v) throw new Error(msg || "expected falsy"); },
};

// useState order in the component: htmlBySource, loaded, activeSource, loading, error.
function renderWith(htmlBySource, activeSource, extra = {}) {
  globalThis.__STATE_QUEUE = [htmlBySource, true, activeSource, false, ""];
  try {
    return JSON.stringify(ChangelogModal({ isOpen: true, onClose: () => {}, ...extra }), (k, v) =>
      typeof v === "function" ? "fn" : v,
    );
  } finally {
    delete globalThis.__STATE_QUEUE;
  }
}

const BOTH = { serenhope: "<p>SEREN_BODY</p>", decolua: "<p>DECO_BODY</p>" };

run("the modal renders both contributor tabs when both loaded", () => {
  const tree = renderWith(BOTH, "serenhope");
  assert.ok(tree.includes("Serenhope"), "fork tab present");
  assert.ok(tree.includes("Decolua"), "upstream tab present");
  assert.ok(tree.includes("Change Log"), "title present");
});

run("only the selected contributor's body is rendered", () => {
  const tree = renderWith(BOTH, "decolua");
  assert.ok(tree.includes("DECO_BODY"), "upstream body shown");
  assert.no(tree.includes("SEREN_BODY"), "fork body not shown");
});

run("the switcher is hidden when only one changelog exists", () => {
  const tree = renderWith({ serenhope: "<p>SEREN_BODY</p>", decolua: "" }, "serenhope");
  assert.ok(tree.includes("SEREN_BODY"), "content still shown");
  assert.no(tree.includes("Decolua"), "no tab for a source with no content");
});

run("a selection pointing at an empty source falls back to what loaded", () => {
  const tree = renderWith({ serenhope: "<p>SEREN_BODY</p>", decolua: "" }, "decolua");
  assert.ok(tree.includes("SEREN_BODY"), "fallback content shown");
  assert.no(tree.includes("DECO_BODY"), "nothing empty rendered");
});

run("with neither changelog the modal says so instead of showing a blank panel", () => {
  const tree = renderWith({ serenhope: "", decolua: "" }, "serenhope");
  assert.ok(tree.includes("No changelog available."), "empty state message");
  assert.no(tree.includes("Serenhope"), "no tabs");
});

run("a closed modal renders nothing", () => {
  const tree = JSON.stringify(ChangelogModal({ isOpen: false, onClose: () => {} }), (k, v) =>
    typeof v === "function" ? "fn" : v,
  );
  assert.equal(tree, "null", "returns null");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
