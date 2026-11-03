import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { getDeactivatedProviderIds } from "@/shared/utils/connectionStatus.js";
import { isCustomEmbeddingProvider } from "@/shared/constants/providers.js";

/**
 * ModelSelectModal.js is JSX living in a .js file and the Vitest/Vite setup has
 * no JSX transform for it, so it cannot be imported directly. The established
 * repository pattern (see kenari-deepseek-vision-zed-modal.test.js and
 * mobile-drawer.test.js) is to verify behaviour through the pure helper modules
 * it depends on, plus a scoped source-contract scan of the component.
 *
 * The source-contract assertions below are deliberately scoped to the enclosing
 * hook/function/callback argument rather than matched against the whole file, so
 * they fail if a caller bypasses the helper they are meant to prove. Matching is
 * tolerant of whitespace, quote style and comment style — it keys on identifiers
 * and argument structure, not byte-exact formatting.
 */

// Extract the full argument list of a hook call, e.g. the
// `useMemo(() => ..., [deps])` argument including its dependency array.
// Brace-matching the OUTER call parens works for both block-bodied
// (`useCallback(...)`) and expression-bodied (`useMemo(() => expr)`) forms —
// where a naive brace-scan of the arrow body silently grabs a sibling block.
function extractCallArgs(src, anchorRegex) {
  const anchor = anchorRegex.exec(src);
  if (!anchor) return null;
  const open = src.indexOf("(", anchor.index + anchor[0].length - 1);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

// Find the argument list of the first `hookName(...)` call whose argument text
// contains `needle`. Needed for effects that are not identifiable by a unique
// `const NAME =` prefix (there are several useEffect calls in the component).
function findHookArgsContaining(src, hookName, needle) {
  const re = new RegExp(`${hookName}\\(`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          const args = src.slice(open, i + 1);
          if (args.includes(needle)) return args;
          break;
        }
      }
    }
  }
  return null;
}

// Brace-balanced body extraction for a plain `function name(...) { ... }` body.
function extractBraceBlock(src, anchorRegex) {
  const anchor = anchorRegex.exec(src);
  if (!anchor) return null;
  return extractBraceBlockAfter(src, anchor.index + anchor[0].length - 1);
}

// Brace-balanced `{ ... }` block whose opening brace is the first one at or
// after `fromIndex`. Shared by extractBraceBlock and the callback-body helpers
// so every block extraction uses the same balanced scan.
function extractBraceBlockAfter(src, fromIndex) {
  const start = src.indexOf("{", fromIndex);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// Paren-balanced argument text of the call whose opening `(` is the first one at
// or after `fromIndex`. Returns the inner argument text (no outer parens), or
// null if the parens never balance. This is how the tests isolate the *actual*
// predicate/callback passed to `.filter(...)` rather than a fixed-width window.
function extractParenArgs(src, fromIndex) {
  const open = src.indexOf("(", fromIndex);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

// Isolate the expression actually RETURNED by `return RECEIVER.filter(...)` and
// return `{ receiver, argument }` — the method receiver identifier and the
// paren-balanced argument text. A `.filter(...)` call whose result is discarded
// (a bare statement before the return) can never satisfy this, because only the
// text that follows a `return` keyword is examined.
function extractReturnedFilter(src, receiver) {
  const re = new RegExp(`\\breturn\\s+${receiver}\\s*\\.\\s*filter\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  const openIndex = m.index + m[0].length - 1;
  const argument = extractParenArgs(src, openIndex);
  if (argument === null) return null;
  let depth = 0;
  let closeIndex = -1;
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }
  return { receiver, argument, tail: src.slice(closeIndex + 1) };
}

// Strip // and /* */ comments so assertions key on code, not comment prose.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("getDeactivatedProviderIds", () => {
  it("identifies providers with connections where all are isActive === false", () => {
    const connections = [
      { provider: "openai-compatible-chat-1", name: "Conn 1", isActive: false },
      { provider: "openai-compatible-chat-1", name: "Conn 2", isActive: false },
      { provider: "gemini", name: "Gemini 1", isActive: false },
    ];
    const deactivated = getDeactivatedProviderIds(connections);
    expect(deactivated.has("openai-compatible-chat-1")).toBe(true);
    expect(deactivated.has("gemini")).toBe(true);
    expect(deactivated.size).toBe(2);
  });

  it("does not deactivate provider if at least one connection is active", () => {
    const connections = [
      { provider: "openai-compatible-chat-1", name: "Conn 1", isActive: false },
      { provider: "openai-compatible-chat-1", name: "Conn 2", isActive: true },
      { provider: "anthropic", name: "Anthropic 1", isActive: true },
    ];
    const deactivated = getDeactivatedProviderIds(connections);
    expect(deactivated.has("openai-compatible-chat-1")).toBe(false);
    expect(deactivated.has("anthropic")).toBe(false);
    expect(deactivated.size).toBe(0);
  });

  it("does not deactivate providers with 0 connections (e.g. keyless local Ollama)", () => {
    const connections = [
      { provider: "other-provider", name: "Other", isActive: false },
    ];
    const deactivated = getDeactivatedProviderIds(connections);
    // Provider not in connections array is not considered deactivated
    expect(deactivated.has("local-ollama-node")).toBe(false);
  });

  it("handles empty or null connections list safely", () => {
    expect(getDeactivatedProviderIds([]).size).toBe(0);
    expect(getDeactivatedProviderIds(null).size).toBe(0);
    expect(getDeactivatedProviderIds(undefined).size).toBe(0);
  });
});

describe("ModelSelectModal custom embedding filter contract", () => {
  // filterActiveProvidersForKind classifies a connection with
  //   isCustomEmbeddingProvider(provider) ? kind === "embedding"
  //                                      : (AI_PROVIDERS[provider]?.serviceKinds || ["llm"]).includes(kind)
  // The custom-embedding half is exercised below through the same pure helper
  // the component imports, so the contract is verified without loading JSX.
  const kindFor = (providerId) => {
    if (isCustomEmbeddingProvider(providerId)) return ["embedding"];
    return ["llm"];
  };

  it("classifies a custom embedding connection as embedding-only, never llm", () => {
    const providerId = "custom-embedding-connection-1";
    const customEmbedding = { provider: providerId, isActive: true };

    const keptForEmbedding = [customEmbedding].filter((p) => kindFor(p.provider).includes("embedding"));
    const keptForLlm = [customEmbedding].filter((p) => kindFor(p.provider).includes("llm"));

    expect(keptForEmbedding).toEqual([customEmbedding]);
    expect(keptForLlm).toEqual([]);
  });

  it("keeps the custom embedding connection when embedding is the active kind filter", () => {
    const customEmbedding = { provider: "custom-embedding-connection-1", isActive: true };
    expect(isCustomEmbeddingProvider(customEmbedding.provider)).toBe(true);
    expect(kindFor(customEmbedding.provider).includes("embedding")).toBe(true);
  });

  it("does not treat a standard provider as a custom embedding provider", () => {
    expect(isCustomEmbeddingProvider("openai-compatible-chat-1")).toBe(false);
    expect(isCustomEmbeddingProvider("gemini")).toBe(false);
  });
});

describe("ModelSelectModal source contract for deactivated providers", () => {
  let src;
  let code;
  beforeAll(() => {
    const fileUrl = new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url);
    src = fs.readFileSync(fileUrl, "utf-8");
    code = stripComments(src);
  });

  it("imports and uses getDeactivatedProviderIds", () => {
    expect(code).toMatch(/import\s*\{[^}]*\bgetDeactivatedProviderIds\b[^}]*\}\s*from\s*["']@\/shared\/utils\/connectionStatus["']/);
    expect(src).toContain("deactivatedProviderIds");
  });

  it("derives deactivatedProviderIds from effectiveConnections via the helper", () => {
    // Scoped to the deactivatedProviderIds memo: proves the helper is fed the
    // component's effective connection source, not some ad-hoc local list.
    const memo = extractCallArgs(code, /const\s+deactivatedProviderIds\s*=\s*useMemo\(/);
    expect(memo).not.toBeNull();
    expect(memo).toMatch(/getDeactivatedProviderIds\s*\(\s*effectiveConnections\s*\)/);
  });

  it("wires filteredActiveProviders to filterActiveProvidersForKind with effectiveConnections and kindFilter", () => {
    // Oracle gap: the old scan proved the helper text existed and separately
    // re-implemented its logic, but never proved the component's grouping input
    // is produced by calling the helper. Asserting the call site inside the
    // filteredActiveProviders memo catches a caller that bypasses it.
    const memo = extractCallArgs(code, /const\s+filteredActiveProviders\s*=\s*useMemo\(/);
    expect(memo).not.toBeNull();
    expect(memo).toMatch(/filterActiveProvidersForKind\s*\(\s*effectiveConnections\s*,\s*kindFilter\s*\)/);
    // And the memo must depend on both inputs so it recomputes when either moves.
    expect(memo).toMatch(/\[\s*effectiveConnections\s*,\s*kindFilter\s*\]/);
  });

  it("feeds helper output through buildGroupsForKind into groupedModels", () => {
    // buildGroupsForKind must consume filterActiveProvidersByKind (the helper route),
    // and the memo that renders must call buildGroupsForKind(kindFilter). If a
    // refactor routed around filterActiveProvidersForKind this breaks.
    const buildArgs = extractCallArgs(code, /const\s+buildGroupsForKind\s*=\s*useCallback\(/);
    expect(buildArgs).not.toBeNull();
    expect(buildArgs).toMatch(/filterActiveProvidersByKind\s*\(/);
    const groupedMemo = extractCallArgs(code, /const\s+groupedModels\s*=\s*useMemo\(/);
    expect(groupedMemo).not.toBeNull();
    expect(groupedMemo).toMatch(/buildGroupsForKind\s*\(\s*kindFilter\s*\)/);
  });

  it("consumes filteredActiveProviders inside filterActiveProvidersByKind", () => {
    // Oracle gap: the old body only proved filterActiveProvidersByKind existed and
    // was called. It must be shown to read the memo produced by
    // filterActiveProvidersForKind and to RETURN its .filter(...) result — a
    // discarded `filteredActiveProviders.filter(...);` statement followed by a
    // bare `return filteredActiveProviders;` must NOT pass. Only the expression
    // after the `return` keyword is inspected, so a discarded call cannot satisfy
    // it.
    const cbArgs = extractCallArgs(code, /const\s+filterActiveProvidersByKind\s*=\s*useCallback\(/);
    expect(cbArgs).not.toBeNull();
    const body = extractBraceBlockAfter(cbArgs, cbArgs.indexOf("=>"));
    expect(body).not.toBeNull();
    expect(body).toMatch(/if\s*\(\s*!\s*kind\s*\)\s*return\s+filteredActiveProviders\s*;/);
    const returned = extractReturnedFilter(body, "filteredActiveProviders");
    expect(returned).not.toBeNull();
    // The returned .filter(...) argument is the filtering callback, not empty.
    expect(returned.argument).toMatch(/\(\s*[A-Za-z_$][\w$]*\s*\)\s*=>/);
    // After the returned call only its `;` and the closing `}` may remain —
    // proves the filter result is the returned value, not a discarded statement.
    expect(returned.tail).toMatch(/^\s*;?\s*\}\s*$/);
    // Dependency array must track the memo it reads.
    expect(cbArgs).toMatch(/\[\s*filteredActiveProviders\s*\]/);
  });

  it("applies each deactivation check with its own callback parameter", () => {
    // Oracle gap: the old test counted generic `deactivatedProviderIds.has(` hits
    // across the whole file, so any three lookups passed even if a caller looked
    // up the wrong identifier. Here each specific filter callback is extracted and
    // must use the identifier that callback binds — proven by a capture/backreference
    // (\1). Method-call matching tolerates whitespace around the dot and parens
    // and uses no arbitrary character window, so it is not formatting-sensitive.
    // Third pattern is anchored to the providerIdsToShow Set so a stray `.filter()`
    // elsewhere cannot satisfy it.
    const noAuth = code.match(
      /NO_AUTH_PROVIDER_IDS\b[\s\S]*?\.\s*filter\s*\(\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*!\s*deactivatedProviderIds\s*\.\s*has\s*\(\s*\1\s*\)\s*\)/
    );
    expect(noAuth).not.toBeNull();
    expect(noAuth[1]).toBe("id");

    const compatible = code.match(
      /compatibleNodeIds\b[\s\S]*?\.\s*filter\s*\(\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>[\s\S]*?!\s*deactivatedProviderIds\s*\.\s*has\s*\(\s*\1\s*\)/
    );
    expect(compatible).not.toBeNull();
    expect(compatible[1]).toBe("alias");

    const providerIdsToShow = code.match(
      /providerIdsToShow\s*=\s*new\s+Set\([\s\S]*?\.\s*filter\s*\(\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*!\s*deactivatedProviderIds\s*\.\s*has\s*\(\s*\1\s*\)\s*\)/
    );
    expect(providerIdsToShow).not.toBeNull();
    expect(providerIdsToShow[1]).toBe("id");
  });

  it("fetches /api/providers on modal open", () => {
    expect(code).toMatch(/await\s+fetch\(\s*["']\/api\/providers["']\s*\)/);
    const effect = findHookArgsContaining(code, "useEffect", "fetchConnections()");
    expect(effect).not.toBeNull();
    expect(effect).toMatch(/if\s*\(\s*isOpen\s*\)\s*fetchConnections\(\)/);
    expect(effect).toMatch(/\[\s*isOpen\s*\]/);
  });

  it("keeps the custom-embedding branch of filterActiveProvidersForKind structured correctly", () => {
    const fnBlock = extractBraceBlock(code, /export\s+function\s+filterActiveProvidersForKind\s*\(/);
    expect(fnBlock).not.toBeNull();
    // Custom embedding branch: ternary keyed on the helper, embedding when true.
    expect(fnBlock).toMatch(/isCustomEmbeddingProvider\s*\(\s*provider\.provider\s*\)/);
    expect(fnBlock).toMatch(/\?\s*kindFilter\s*===\s*["']embedding["']/);
    // Standard branch: serviceKinds lookup with ["llm"] default.
    expect(fnBlock).toMatch(/AI_PROVIDERS\[provider\.provider\]\?\.serviceKinds\s*\|\|\s*\[["']llm["']\]/);
  });

  it("binds the standard-provider includes(kindFilter) to the helper's returned filter", () => {
    // Oracle gap: scanning the whole function body let a dead `.includes(kindFilter)`
    // (unreachable code after an early return) satisfy the assertion while the
    // actual returned predicate filtered by something else. Here the returned
    // `activeOnly.filter(...)` argument is extracted with a paren-balanced scan
    // (not a fixed-width window) and must contain no `return` statement, so the
    // standard-branch `.includes(kindFilter)` is provably the expression the
    // filter evaluates.
    const fnBlock = extractBraceBlock(code, /export\s+function\s+filterActiveProvidersForKind\s*\(/);
    expect(fnBlock).not.toBeNull();
    const returned = extractReturnedFilter(fnBlock, "activeOnly");
    expect(returned).not.toBeNull();
    const predicate = returned.argument;
    expect(predicate).toMatch(/isCustomEmbeddingProvider\s*\(\s*provider\.provider\s*\)/);
    // No statement body means no dead code can hide the real predicate.
    expect(predicate).not.toMatch(/\breturn\b/);
    // The false arm of the ternary — the standard-provider branch actually
    // returned by the filter — is the one that must call `.includes(kindFilter)`.
    expect(predicate).toMatch(/\?\s*kindFilter\s*===\s*["']embedding["']\s*:\s*\(?\s*AI_PROVIDERS\[provider\.provider\]\?\.serviceKinds\s*\|\|\s*\[["']llm["']\]\s*\)?\s*\.\s*includes\s*\(\s*kindFilter\s*\)/);
  });
});
