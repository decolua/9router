function stripAnsi(input) {
  return String(input || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function truncate(value, max = 120) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function countBy(values) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function typeScriptDiagnostics(input) {
  const text = stripAnsi(input);
  const lines = text.split("\n");
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const match = re.exec(lines[i]);
    if (!match) continue;
    const err = { file: match[1], line: match[2], code: match[5], message: match[6], context: [] };
    i++;
    while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === "")) {
      if (lines[i].trim()) err.context.push(lines[i].trim());
      i++;
    }
    i--;
    errors.push(err);
  }

  if (errors.length === 0) {
    if (/Found 0 errors/i.test(text)) return "TypeScript: No errors found";
    return input;
  }

  const byFile = new Map();
  for (const err of errors) {
    if (!byFile.has(err.file)) byFile.set(err.file, []);
    byFile.get(err.file).push(err);
  }

  const out = [`TypeScript: ${errors.length} errors in ${byFile.size} files`];
  const topCodes = countBy(errors.map((e) => e.code));
  if (topCodes.length > 1) out.push(`Top codes: ${topCodes.slice(0, 5).map(([code, count]) => `${code} (${count}x)`).join(", ")}`);
  for (const [file, fileErrors] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`${file} (${fileErrors.length} errors)`);
    for (const err of fileErrors) {
      out.push(`  L${err.line}: ${err.code} ${truncate(err.message)}`);
      for (const ctx of err.context.slice(0, 2)) out.push(`    ${truncate(ctx)}`);
    }
  }
  return out.join("\n");
}
typeScriptDiagnostics.filterName = "typescript";

export function mypyDiagnostics(input) {
  const text = stripAnsi(input);
  const lines = text.split("\n");
  const re = /^(.+?):(\d+)(?::\d+)?: (error|warning|note): (.+?)(?:\s+\[(.+)\])?$/;
  const errors = [];
  const fileless = [];

  for (const line of lines) {
    const match = re.exec(line);
    if (match && match[3] !== "note") {
      errors.push({ file: match[1], line: match[2], code: match[5] || "", message: match[4] });
    } else if (line.includes("error:") && line.trim() && !line.startsWith("Found ")) {
      fileless.push(line);
    }
  }

  if (errors.length === 0 && fileless.length === 0) {
    if (/Success: no issues found|no issues found/i.test(text)) return "mypy: No issues found";
    return input;
  }

  const byFile = new Map();
  for (const err of errors) {
    if (!byFile.has(err.file)) byFile.set(err.file, []);
    byFile.get(err.file).push(err);
  }

  const out = [...fileless];
  if (errors.length > 0) {
    out.push(`mypy: ${errors.length} errors in ${byFile.size} files`);
    const topCodes = countBy(errors.map((e) => e.code).filter(Boolean));
    if (topCodes.length > 1) out.push(`Top codes: ${topCodes.slice(0, 5).map(([code, count]) => `${code} (${count}x)`).join(", ")}`);
    for (const [file, fileErrors] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`${file} (${fileErrors.length} errors)`);
      for (const err of fileErrors) {
        out.push(`  L${err.line}: ${err.code ? `[${err.code}] ` : ""}${truncate(err.message)}`);
      }
    }
  }
  return out.join("\n");
}
mypyDiagnostics.filterName = "mypy";

export function pytestDiagnostics(input) {
  const text = stripAnsi(input);
  const summary = [...text.matchAll(/(?:=+\s*)?(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?.*?\sin\s[\d.]+s(?:\s*=+)?/g)].pop();
  const failedOnly = [...text.matchAll(/(?:=+\s*)?(\d+)\s+failed(?:,\s*(\d+)\s+passed)?(?:,\s*(\d+)\s+skipped)?.*?\sin\s[\d.]+s(?:\s*=+)?/g)].pop();
  if (!summary && !failedOnly && !/collected 0 items|no tests ran/i.test(text)) return input;
  if (/collected 0 items|no tests ran/i.test(text)) return "Pytest: No tests collected";

  const passed = summary ? Number(summary[1] || 0) : Number(failedOnly?.[2] || 0);
  const failed = summary ? Number(summary[2] || 0) : Number(failedOnly?.[1] || 0);
  const skipped = Number((summary ? summary[3] : failedOnly?.[3]) || 0);
  const out = [`Pytest: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`];

  if (failed > 0) {
    const relevant = text.split("\n").filter((line) => {
      const t = line.trim();
      return t.startsWith("FAILED ") || t.startsWith("ERROR ") || t.startsWith("E ") || t.startsWith("E\t") || t.startsWith(">") || t.includes("AssertionError") || t.includes(".py:");
    });
    for (const line of relevant.slice(0, 20)) out.push(truncate(line.trim(), 140));
    if (relevant.length > 20) out.push(`... +${relevant.length - 20} more failure lines`);
  }
  return out.join("\n");
}
pytestDiagnostics.filterName = "pytest";

export function vitestDiagnostics(input) {
  const text = stripAnsi(input);
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (typeof parsed.numTotalTests === "number") {
        const failed = parsed.numFailedTests || 0;
        const out = [`Vitest: ${parsed.numPassedTests || 0} passed, ${failed} failed, ${parsed.numPendingTests || 0} skipped`];
        if (failed > 0 && Array.isArray(parsed.testResults)) {
          for (const file of parsed.testResults) {
            for (const test of file.assertionResults || []) {
              if (test.status !== "failed") continue;
              out.push(`${file.name}: ${test.fullName}`);
              for (const msg of (test.failureMessages || []).slice(0, 2)) out.push(`  ${truncate(msg.replace(/\s+/g, " "), 140)}`);
            }
          }
        }
        return out.join("\n");
      }
    } catch {
      // Fall through to text parser.
    }
  }

  const testsLine = /Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed/i.exec(text);
  if (!testsLine) return input;
  const failed = Number(testsLine[1] || 0);
  const passed = Number(testsLine[2] || 0);
  const out = [`Vitest: ${passed} passed, ${failed} failed`];
  if (failed > 0) {
    const relevant = text.split("\n").filter((line) => /FAIL|Error:|AssertionError|expected|received/i.test(line));
    for (const line of relevant.slice(0, 20)) out.push(truncate(line.trim(), 140));
    if (relevant.length > 20) out.push(`... +${relevant.length - 20} more failure lines`);
  }
  return out.join("\n");
}
vitestDiagnostics.filterName = "vitest";

export function goTestDiagnostics(input) {
  const text = stripAnsi(input);
  const lines = text.split("\n");
  if (!lines.some((line) => line.trim().startsWith("{") && line.includes("\"Action\""))) return input;

  let passed = 0;
  let failed = 0;
  const failures = [];
  for (const line of lines) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const item = JSON.parse(line);
      if (item.Action === "pass" && item.Test) passed++;
      if (item.Action === "fail" && item.Test) {
        failed++;
        failures.push(`${item.Package || ""} ${item.Test}`.trim());
      }
    } catch {
      // Ignore partial lines.
    }
  }
  if (passed === 0 && failed === 0) return input;
  const out = [`Go test: ${passed} passed, ${failed} failed`];
  for (const failure of failures.slice(0, 20)) out.push(`FAIL ${failure}`);
  if (failures.length > 20) out.push(`... +${failures.length - 20} more failures`);
  return out.join("\n");
}
goTestDiagnostics.filterName = "go-test";
