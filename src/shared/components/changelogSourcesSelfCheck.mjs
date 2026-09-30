// Changelog source selection self-check.
// Run: node src/shared/components/changelogSourcesSelfCheck.mjs
// No framework, no deps.
//
// The switching itself is one onClick. What can actually go wrong is the empty
// cases: upstream GitHub can be unreachable, a fork may have no changelog of its
// own yet, and a stale selection then leaves the modal body blank with no
// explanation. Those are the cases pinned here.
import {
  CHANGELOG_SOURCES,
  SERENHOPE_SOURCE,
  DECOLUA_SOURCE,
  DEFAULT_CHANGELOG_SOURCE,
  availableChangelogSources,
  pickChangelogSource,
} from "./changelogSources.js";

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

const BOTH = { serenhope: "<p>seren</p>", decolua: "<p>deco</p>" };
const ONLY_SEREN = { serenhope: "<p>seren</p>", decolua: "" };
const ONLY_DECO = { serenhope: "", decolua: "<p>deco</p>" };
const NEITHER = { serenhope: "", decolua: "" };

run("there are exactly two sources, fork first", () => {
  assert.equal(CHANGELOG_SOURCES.length, 2, "two sources");
  assert.equal(CHANGELOG_SOURCES[0].id, "serenhope", "fork listed first");
  assert.equal(CHANGELOG_SOURCES[1].id, "decolua", "upstream second");
  assert.equal(SERENHOPE_SOURCE.id, "serenhope", "exported id");
  assert.equal(DECOLUA_SOURCE.id, "decolua", "exported id");
});

run("both sources are offered when both have content", () => {
  const available = availableChangelogSources(BOTH);
  assert.equal(available.length, 2, "both offered");
  assert.equal(available[0].id, "serenhope", "order preserved");
});

run("the fork opens first by default", () => {
  assert.equal(DEFAULT_CHANGELOG_SOURCE, "serenhope", "default is the fork");
  assert.equal(pickChangelogSource(BOTH, DEFAULT_CHANGELOG_SOURCE), "serenhope", "default shows the fork");
});

run("choosing the upstream source is honoured", () => {
  assert.equal(pickChangelogSource(BOTH, "decolua"), "decolua", "switched");
});

run("a source with no content is not offered as a tab", () => {
  assert.equal(availableChangelogSources(ONLY_SEREN).length, 1, "one tab");
  assert.equal(availableChangelogSources(ONLY_SEREN)[0].id, "serenhope", "the one with content");
  assert.equal(availableChangelogSources(ONLY_DECO)[0].id, "decolua", "same the other way");
  assert.equal(availableChangelogSources(NEITHER).length, 0, "no tabs when neither loaded");
});

run("a selection pointing at an empty source falls back to what exists", () => {
  // The realistic case: the user picks Decolua, then upstream goes down and a
  // reload brings back only the fork. Without the fallback the body is blank.
  assert.equal(pickChangelogSource(ONLY_SEREN, "decolua"), "serenhope", "falls back to the fork");
  assert.equal(pickChangelogSource(ONLY_DECO, "serenhope"), "decolua", "falls back to upstream");
});

run("with nothing loaded at all it still names a source", () => {
  assert.equal(pickChangelogSource(NEITHER, "decolua"), DEFAULT_CHANGELOG_SOURCE, "never undefined");
  assert.ok(pickChangelogSource(null, null), "null input still resolves");
  assert.ok(pickChangelogSource(undefined, undefined), "undefined input still resolves");
  assert.equal(availableChangelogSources(null).length, 0, "null offers nothing");
});

run("an unknown source id is not trusted", () => {
  assert.equal(pickChangelogSource(BOTH, "someone-else"), "serenhope", "falls back rather than rendering nothing");
});

run("whitespace-only content counts as empty", () => {
  assert.equal(availableChangelogSources({ serenhope: "   ", decolua: "<p>x</p>" }).length, 1, "blank ignored");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
