// @monaco-editor/react does not use the monaco-editor package from node_modules: its
// loader fetches Monaco from jsdelivr at a version hardcoded in @monaco-editor/loader.
// Pin that copy to the version in package.json, so a Monaco upgrade (and the DOMPurify
// fixes bundled in it) actually reaches the browser. tests/unit/monaco-version.test.js
// fails if this drifts from the installed package.
export const MONACO_VERSION = "0.57.0";
export const MONACO_VS_PATH = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
