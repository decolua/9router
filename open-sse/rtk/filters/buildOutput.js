// Compress build tool output (npm, cargo, pip, maven, gradle, etc.)
// Keeps: errors, warnings, final summary
// Strips: progress logs, verbose "Compiling X" lists, download logs

export function buildOutput(input) {
  const lines = input.split("\n");
  if (lines.length === 0) return input;

  const errors = [];
  const warnings = [];
  let summary = null;
  let deprecatedCount = 0;
  let compilingCount = 0;
  let downloadingCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // npm/yarn errors
    if (/^npm (ERR!|error)/i.test(trimmed) || /^yarn error/i.test(trimmed)) {
      errors.push(line);
      continue;
    }

    // npm/yarn warnings (count deprecations, keep other warnings)
    if (/^npm warn deprecated/i.test(trimmed)) {
      deprecatedCount++;
      continue;
    }
    if (/^npm warn/i.test(trimmed) || /^yarn warn/i.test(trimmed)) {
      warnings.push(line);
      continue;
    }

    // cargo/rust errors
    if (/^error(\[|:)/i.test(trimmed) || trimmed.startsWith("error -->")) {
      errors.push(line);
      continue;
    }

    // cargo/rust warnings
    if (/^warning(\[|:)/i.test(trimmed) || trimmed.startsWith("warning -->")) {
      warnings.push(line);
      continue;
    }

    // pip errors
    if (/^ERROR:/i.test(trimmed)) {
      errors.push(line);
      continue;
    }

    // maven/gradle errors
    if (/^\[ERROR\]/i.test(trimmed) || /^BUILD FAILED/i.test(trimmed)) {
      errors.push(line);
      continue;
    }

    // maven/gradle warnings
    if (/^\[WARNING\]/i.test(trimmed)) {
      warnings.push(line);
      continue;
    }

    // Count verbose progress lines (don't keep them)
    if (/^\s*Compiling\s+\S+/i.test(trimmed)) {
      compilingCount++;
      continue;
    }
    if (/^\s*Downloading\s+\S+/i.test(trimmed) || /^Fetching\s+/i.test(trimmed)) {
      downloadingCount++;
      continue;
    }

    // Final summary lines (keep these)
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

  // Build compressed output
  let out = "";

  // Deprecation summary
  if (deprecatedCount > 0) {
    out += `npm warn deprecated: ${deprecatedCount} package${deprecatedCount > 1 ? "s" : ""}\n`;
  }

  // Progress summary
  if (compilingCount > 0) {
    out += `Compiled ${compilingCount} package${compilingCount > 1 ? "s" : ""}\n`;
  }
  if (downloadingCount > 0) {
    out += `Downloaded ${downloadingCount} package${downloadingCount > 1 ? "s" : ""}\n`;
  }

  // Warnings (keep first 5)
  if (warnings.length > 0) {
    out += warnings.slice(0, 5).join("\n") + "\n";
    if (warnings.length > 5) {
      out += `... +${warnings.length - 5} more warnings\n`;
    }
  }

  // Errors (keep all)
  if (errors.length > 0) {
    out += errors.join("\n") + "\n";
  }

  // Final summary
  if (summary) {
    out += summary + "\n";
  }

  // Fallback: if we stripped everything, return a minimal summary
  if (!out.trim()) {
    if (compilingCount > 0 || downloadingCount > 0) {
      return `Build completed (${compilingCount} compiled, ${downloadingCount} downloaded)`;
    }
    return input; // Safety: return original if we can't parse it
  }

  return out.replace(/\n+$/, "");
}

buildOutput.filterName = "build-output";
