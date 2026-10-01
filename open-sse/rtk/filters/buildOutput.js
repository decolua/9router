// Compress build tool output (npm, cargo, pip, maven, gradle, etc.)
// Keeps: errors, warnings, final summary
// Strips: progress logs, verbose "Compiling X" lists, download logs

// Cargo/rustc error continuation: " --> file:line", "  |", "N | code", "  = note: ..."
const RE_CARGO_ERR_CONT = /^\s*(-->|\||\d+\s*\||=)/;
const DEPRECATION_KEEP = 3;

export function buildOutput(input) {
  const lines = input.split("\n");
  if (lines.length === 0) return input;

  const errors = [];
  const warnings = [];
  const deprecations = [];
  let summary = null;
  let compilingCount = 0;
  let downloadingCount = 0;
  let inCargoError = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Continuation of cargo error block: keep verbatim while in block
    if (inCargoError) {
      if (!trimmed) { inCargoError = false; continue; }
      if (RE_CARGO_ERR_CONT.test(line)) { errors.push(line); continue; }
      inCargoError = false;
    }

    if (!trimmed) continue;

    if (/^npm (ERR!|error)/i.test(trimmed) || /^yarn error/i.test(trimmed)) {
      errors.push(line);
      continue;
    }

    if (/^npm warn deprecated/i.test(trimmed)) {
      deprecations.push(line);
      continue;
    }
    if (/^npm warn/i.test(trimmed) || /^yarn warn/i.test(trimmed)) {
      warnings.push(line);
      continue;
    }

    if (/^error(\[|:)/i.test(trimmed) || trimmed.startsWith("error -->")) {
      errors.push(line);
      inCargoError = true;
      continue;
    }

    if (/^warning(\[|:)/i.test(trimmed) || trimmed.startsWith("warning -->")) {
      warnings.push(line);
      inCargoError = true;
      continue;
    }

    if (/^ERROR:/i.test(trimmed)) {
      errors.push(line);
      continue;
    }

    if (/^\[ERROR\]/i.test(trimmed) || /^BUILD FAILED/i.test(trimmed)) {
      errors.push(line);
      continue;
    }

    if (/^\[WARNING\]/i.test(trimmed)) {
      warnings.push(line);
      continue;
    }

    if (/^\s*Compiling\s+\S+/i.test(trimmed)) {
      compilingCount++;
      continue;
    }
    if (/^\s*Downloading\s+\S+/i.test(trimmed) || /^Fetching\s+/i.test(trimmed)) {
      downloadingCount++;
      continue;
    }

    if (
      /^(added|removed|changed|audited|installed)\s+\d+\s+package/i.test(trimmed) ||
      /^\s*Finished\s+/i.test(trimmed) ||
      /^BUILD SUCCESS/i.test(trimmed) ||
      /^\d+\s+(vulnerabilities|packages?|warnings?|errors?)/i.test(trimmed) ||
      /^Successfully (installed|built)/i.test(trimmed) ||
      /^To address .* issues/i.test(trimmed) ||
      /^Run `npm (audit|fund)`/i.test(trimmed) ||
      /packages are looking for funding/i.test(trimmed)
    ) {
      summary = summary ? `${summary}\n${line}` : line;
      continue;
    }
  }

  let out = "";

  // Keep first N deprecations verbatim (package name + reason), count the rest
  const keepDep = deprecations.slice(0, DEPRECATION_KEEP);
  for (const d of keepDep) out += `${d}\n`;
  if (deprecations.length > DEPRECATION_KEEP) {
    out += `... +${deprecations.length - DEPRECATION_KEEP} more deprecated packages\n`;
  }

  if (compilingCount > 0) {
    out += `Compiled ${compilingCount} packages\n`;
  }
  if (downloadingCount > 0) {
    out += `Downloaded ${downloadingCount} packages\n`;
  }

  for (const e of errors) out += `${e}\n`;

  const keepWarnings = warnings.slice(0, 5);
  for (const w of keepWarnings) out += `${w}\n`;
  if (warnings.length > 5) {
    out += `... +${warnings.length - 5} more warnings\n`;
  }

  if (summary) out += `${summary}\n`;

  return out.replace(/\n+$/, "") || input;
}

buildOutput.filterName = "build-output";
