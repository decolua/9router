import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

// Exercise the production normalizer without importing unrelated network dependencies.
const source = readFileSync(new URL('../../open-sse/executors/codex.js', import.meta.url), 'utf8');
const normalizer = source.slice(source.indexOf('function normalizeCodexTools('), source.indexOf('// Resolve prompt-cache session id:'));
function normalize(tools) {
  const body = { tools: structuredClone(tools) };
  runInNewContext(`${normalizer}\nnormalizeCodexTools(body);`, {
    body, stripCodexUnsupportedPatterns: value => value,
    CODEX_PASSTHROUGH_TOOL_TYPES: new Set(['custom']),
    CODEX_HOSTED_TOOL_TYPES: new Set(), dbg() {},
  });
  return body.tools;
}

test('Codex preserves explicit strict modes and optional parameter requirements', () => {
  for (const strict of [false, true]) {
    for (const nested of [false, true]) {
      const fn = { name: 'probe', strict, parameters: {
        type: 'object', properties: { agent: { type: 'string' }, sessionID: { type: 'string' } },
        required: ['agent'], additionalProperties: false,
      } };
      const [tool] = normalize([nested ? { type: 'function', function: fn } : { type: 'function', ...fn }]);
      assert.equal(tool.strict, strict);
      assert.deepEqual(tool.parameters, fn.parameters);
    }
  }
});

test('unspecified strict mode stays unspecified', () => {
  const [tool] = normalize([{ type: 'function', name: 'probe', parameters: { type: 'object', properties: {} } }]);
  assert.equal(Object.hasOwn(tool, 'strict'), false);
});
