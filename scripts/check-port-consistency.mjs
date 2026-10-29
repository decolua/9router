#!/usr/bin/env node
// Port-consistency divergence guard (DF-9ROUTER-44).
//
// 20128 is the single canonical 9router server port for this repo. This guard
// asserts every place that PINS the 9router server port agrees on 20128, and
// exits 1 otherwise.
//
// Scope — what counts as a pin (checked):
//   - package.json scripts: `--port NNNNN` literals and the `${PORT:-NNNNN}`
//     shell default (the dev scripts keep the shell form so an exported PORT
//     still overrides the script's own expansion; the DEFAULT must stay 20128).
//   - .env.example: the uncommented `PORT=NNNNN` line, plus `BASE_URL` /
//     `NEXT_PUBLIC_BASE_URL` localhost URLs.
//   - README.md: inline `PORT=NNNNN` / `export PORT=NNNNN` command lines,
//     BASE_URL-keyed localhost URLs outside table rows (table rows document
//     upstream/legacy defaults, not this repo's pins), and docker `-p A:B`
//     mappings for the 9router container.
//   - start.sh: docker port mappings.
//
// Scope — what is deliberately NOT a pin (not checked):
//   - Ports of OTHER services in docs (LM Studio :1234, Ollama :11434,
//     SearXNG :8888, Headroom :8787, HTTP proxies :7890, self-hosted STT :8080):
//     they document upstream endpoints, not the 9router server port.
//   - README's `PORT=20129` / `localhost:20129` demo block: a deliberate
//     non-default port proving the launcher's override + occupied-port
//     refusal behavior ("start on a free port" walkthrough). 20129 is the
//     sanctioned demo port.
//
// Precedence note (why .env.example's comment matters): Next.js loads .env
// AFTER process env, so for values the app reads itself an env-FILE value
// wins over an env-VAR value. The package.json dev scripts keep the
// `${PORT:-20128}` shell form — that expansion resolves BEFORE next starts,
// so an exported PORT overrides the script's own default; but once the app
// reads PORT itself, .env wins. Predicting the port requires both files to
// agree on 20128 — which is exactly what this guard asserts.
import { readFileSync } from 'node:fs';

const CANONICAL = '20128';
const FILES = ['README.md', '.env.example', 'package.json', 'start.sh'];

// [regex, appliesTo] — flag when the captured port is not canonical.
// All patterns are anchored to 9router's own port-pin surfaces (see header).
const PATTERNS = [
  // next dev --port NNNNN literal (package.json scripts only; README has no
  // `--port` for 9router, and headroom's `--port 8787` is another service).
  { re: /--port[= ](\d{4,5})/g, files: ['package.json'] },
  // `${PORT:-NNNNN}` shell default inside scripts — asserts the default.
  { re: /\$\{PORT[^\d}]*?(\d{4,5})\}/g, files: ['package.json'] },
  // Env-file / inline PORT assignment (commented and PROXY_* lines don't match
  // the line-start anchor; compose host-mapping comments excluded by design).
  { re: /^\s*(?:export\s+)?PORT[=:]\s*"?(\d{4,5})/gm, files: ['README.md', '.env.example'] },
  // BASE_URL-keyed localhost URLs; table rows (`| ...`) document defaults, skip them.
  { re: /BASE_URL[=:]\s*"?https?:\/\/(?:localhost|127\.0\.0\.1):(\d{4,5})/g, files: ['README.md', '.env.example'], skipLine: /^\s*\|/ },
  // docker port mappings (start.sh, README docker runs; `host:container`).
  { re: /-p\s+(\d{4,5}):(\d{4,5})/g, files: ['README.md', 'start.sh'] },
];

// Lines that never count as pins (deliberate non-canonical demo ports).
const NON_PIN = [
  /cli\/cli\.js/,        // launcher port-override demos (README 20129 block)
  /localhost:20129/,     // free-port curl walkthrough (README 20129 block)
  /PORT=20129/,          // same block, inline env form
];

// Per-file MUST-HAVE: the canonical pin anchor must exist at all — a file
// losing its pin entirely fails loudly instead of passing vacuously.
const ANCHORS = {
  'package.json': /\$\{PORT:-20128\}/,
  '.env.example': /^PORT=20128$/m,
  'README.md': /PORT=20128 NEXT_PUBLIC_BASE_URL=http:\/\/localhost:20128 npm run dev/,
  'start.sh': /-p 20128:20128/,
};

let failures = 0;
for (const file of FILES) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`FAIL ${file}: cannot read`);
    failures++;
    continue;
  }
  if (!ANCHORS[file].test(text)) {
    console.error(`FAIL ${file}: canonical-pin anchor missing (expected ${CANONICAL})`);
    failures++;
  }
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (NON_PIN.some((re) => re.test(line))) return;
    for (const { re, files, skipLine } of PATTERNS) {
      if (!files.includes(file)) continue;
      if (skipLine && skipLine.test(line)) continue;
      re.lastIndex = 0;
      for (const match of line.matchAll(re)) {
        const ports = match.slice(1).filter(Boolean);
        if (ports.some((p) => p !== CANONICAL)) {
          console.error(`FAIL ${file}:${idx + 1}: port ${ports.join(',')} != canonical ${CANONICAL}`);
          console.error(`     ${line.trim()}`);
          failures++;
        }
      }
    }
  });
}

if (failures > 0) {
  console.error(`\ncheck-port-consistency: ${failures} non-canonical port pin(s) (canonical: ${CANONICAL})`);
  process.exit(1);
}
console.log(`check-port-consistency: OK — all 9router port pins are ${CANONICAL} (${FILES.join(', ')})`);
