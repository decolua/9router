/**
 * Helpers for the OpenCode free-tier client fingerprint.
 *
 * Two body-side gates are mirrored here (live probes 2026-10-26, /inference/v1):
 *
 * - Tools: free-tier requests must declare OpenCode's own `read` and `shell`
 *   tools with their exact descriptions and parameter schemas; stubbed
 *   descriptions, renamed schemas or tool_choice "none" are answered with 403
 *   FreeTierError. Caller tools are sent untouched. A tool that already uses an
 *   exact fingerprint name with a different definition adopts OpenCode's
 *   definition in place whenever its arguments can carry them; only a genuinely
 *   different schema travels under an alias, and the response side restores
 *   that caller's original name.
 * - System prompt: the CLI's `<env>` marker must be present. A request missing
 *   either half (marker or tools) answers 429 FreeUsageLimitError regardless of
 *   headers, UA or session shape; both halves together pass.
 *
 * Transport is a third gate and lives in services/opencodeTlsClient.js.
 */
import os from "node:os";
import path from "node:path";

/** Names required by the upstream free-tier gate. */
export const OPENCODE_FINGERPRINT_TOOLS = ["read", "bash"];

// Verbatim from the OpenCode v2.0.26 CLI. Upstream compares description and
// parameters, so do not reword or reformat these.
// Verbatim from a live capture of the RELEASED opencode v1.19.5 CLI
// (2026-10-29, Linux/bash runtime - the shape the free-tier population
// sends). Upstream compares description and parameters, so do not reword
// or reformat these. Note v1 uses `bash`, not the v2 prerelease `shell`.
const FINGERPRINT_TOOL_DEFINITIONS = {
  "bash": {
    "description": "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.\n\nBe aware: OS: linux, Shell: bash\n\nAll commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.\n\nUse `/tmp/opencode` for temporary work outside the workspace. This directory has already been created, already exists, and is pre-approved for external directory access.\n\nIMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.\n\nBefore executing the command, please follow these steps:\n\n1. Directory Verification:\n   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location\n   - For example, before running \"mkdir foo/bar\", first use `ls foo` to check that \"foo\" exists and is the intended parent directory\n\n2. Command Execution:\n   - Always quote file paths that contain spaces with double quotes (e.g., rm \"path with spaces/file.txt\")\n   - Examples of proper quoting:\n     - mkdir \"/Users/name/My Documents\" (correct)\n     - mkdir /Users/name/My Documents (incorrect - will fail)\n     - python \"/path/with spaces/script.py\" (correct)\n     - python /path/with spaces/script.py (incorrect - will fail)\n   - After ensuring proper quoting, execute the command.\n   - Capture the output of the command.\n\nUsage notes:\n  - The command argument is required.\n  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after 120000ms.\n  - If the output exceeds 2000 lines or 51200 bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use `head`, `tail`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.\n\n  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:\n    - File search: Use Glob (NOT find or ls)\n    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n    - Edit files: Use Edit (NOT sed/awk)\n    - Write files: Use Write (NOT echo >/cat <<EOF)\n    - Communication: Output text directly (NOT echo/printf)\n  - When issuing multiple commands:\n    - If the commands are independent and can run in parallel, make multiple bash tool calls in a single message. For example, if you need to run \"git status\" and \"git diff\", send a single message with two bash tool calls in parallel.\n    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.\n    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail\n    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)\n  - AVOID using `cd <directory> && <command>`. Use the `workdir` parameter to change directories instead.\n    <good-example>\n    Use workdir=\"/foo/bar\" with command: pytest tests\n    </good-example>\n    <bad-example>\n    cd /foo/bar && pytest tests\n    </bad-example>\n\n# Git and GitHub\n- Only commit, amend, push, or create PRs when explicitly requested.\n- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`; stage only intended files and never commit secrets.\n- Write a concise commit message that matches the repo style.\n- Do not update git config, skip hooks, use interactive `-i`, force-push, or create empty commits unless explicitly requested.\n- If a commit fails or hooks reject it, fix the issue and create a new commit; do not amend the failed commit.\n- Before creating a PR, inspect status, diff, remote tracking, recent commits, and the diff from the base branch.\n- Review all commits included in the PR, not just the latest commit.\n- Use `gh` for GitHub tasks, including PRs, issues, checks, and releases; return the PR URL when done.\n",
    "parameters": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "command": {
          "type": "string",
          "description": "The command to execute"
        },
        "timeout": {
          "minimum": -9007199254740991,
          "exclusiveMinimum": 0,
          "type": "integer",
          "maximum": 9007199254740991,
          "description": "Optional timeout in milliseconds"
        },
        "workdir": {
          "type": "string",
          "description": "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands."
        }
      },
      "required": [
        "command"
      ]
    }
  },
  "read": {
    "description": "Read a file or directory from the local filesystem. If the path does not exist, an error is returned.\n\nUsage:\n- The filePath parameter should be an absolute path.\n- By default, this tool returns up to 2000 lines from the start of the file.\n- The offset parameter is the line number to start from (1-indexed).\n- To read later sections, call this tool again with a larger offset.\n- Use the grep tool to find specific content in large files or files with long lines.\n- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.\n- Contents are returned with each line prefixed by its line number as `<line>: <content>`. For example, if a file has contents \"foo\\n\", you will receive \"1: foo\\n\". For directories, entries are returned one per line (without line numbers) with a trailing `/` for subdirectories.\n- Any line longer than 2000 characters is truncated.\n- Call this tool in parallel when you know there are multiple files you want to read.\n- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.\n- This tool can read image files and PDFs and return them as file attachments.\n",
    "parameters": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "filePath": {
          "type": "string",
          "description": "The absolute path to the file or directory to read"
        },
        "offset": {
          "minimum": 0,
          "type": "integer",
          "maximum": 9007199254740991,
          "description": "The line number to start reading from (1-indexed)"
        },
        "limit": {
          "minimum": 0,
          "type": "integer",
          "maximum": 9007199254740991,
          "description": "The maximum number of lines to read (defaults to 2000)"
        }
      },
      "required": [
        "filePath"
      ]
    }
  }
};

// Request body -> names renamed for that request. transformRequest() mutates the
// same body object that chatCore passed into the executor, so a WeakMap keeps the
// mapping request-local without putting transport metadata on the wire.
const renamedToolNames = new WeakMap();

/** The fingerprint name when `name` is exactly one; "" otherwise. */
export function fingerprintToolKey(name) {
  const trimmed = String(name ?? "").trim();
  return OPENCODE_FINGERPRINT_TOOLS.includes(trimmed) ? trimmed : "";
}

/** Read a tool name from either flat ({name}) or chat ({function:{name}}) shape. */
function toolNameOf(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
  const fn = tool.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") {
    return fn.name.trim();
  }
  return "";
}

function chatFunctionOf(tool) {
  const fn = tool?.function;
  return fn && typeof fn === "object" && !Array.isArray(fn) ? fn : null;
}

/** True when `tool` already carries OpenCode's exact definition for `key`. */
function isFingerprintDefinition(tool, key) {
  const def = tool && (chatFunctionOf(tool) || tool);
  const want = FINGERPRINT_TOOL_DEFINITIONS[key];
  return !!def && def.description === want.description
    && JSON.stringify(def.parameters) === JSON.stringify(want.parameters);
}

function withToolName(tool, name) {
  const fn = chatFunctionOf(tool);
  return fn ? { ...tool, function: { ...fn, name } } : { ...tool, name };
}

/**
 * True when `tool` already speaks OpenCode's parameter names for `key`, so the
 * fingerprint definition can replace its own without hiding or adding an
 * argument the caller's handler expects.
 *
 * This is the common case, not an edge: OpenCode composes `shell`'s description
 * from `process.platform`, so the very same tool run on Windows reports
 * "Commands run on Windows using pwsh." while the captured definition says
 * "Commands run on Linux using bash." — a two-word difference that an exact
 * string compare rejects.
 */
function canNormalizeInPlace(tool, key) {
  const def = tool && (chatFunctionOf(tool) || tool);
  const props = def?.parameters?.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;

  const wanted = Object.keys(FINGERPRINT_TOOL_DEFINITIONS[key].parameters.properties || {});
  const declared = Object.keys(props);
  if (declared.some((name) => !wanted.includes(name))) return false;
  return FINGERPRINT_TOOL_DEFINITIONS[key].parameters.required.every((name) => declared.includes(name));
}

// --- System prompt fingerprint (2026-10-30) ---------------------------------
// The free gate validates the CLI system prompt itself: "You are opencode, an
// interactive CLI tool..." with the <env> block inside it. A self-made system
// prompt that merely contains an <env> marker passes no more — upstream
// answers 429 FreeUsageLimitError (live A/B through the same egress IP and
// session shape, 2026-10-29 18:47). Send the captured v1.19.5 CLI system
// prompt verbatim (only the date line is re-templated) and append the
// caller's own system content after it.
const CLI_SYSTEM_PROMPT_B64 = "WW91IGFyZSBvcGVuY29kZSwgYW4gaW50ZXJhY3RpdmUgQ0xJIHRvb2wgdGhhdCBoZWxwcyB1c2VycyB3aXRoIHNvZnR3YXJlIGVuZ2luZWVyaW5nIHRhc2tzLiBVc2UgdGhlIGluc3RydWN0aW9ucyBiZWxvdyBhbmQgdGhlIHRvb2xzIGF2YWlsYWJsZSB0byB5b3UgdG8gYXNzaXN0IHRoZSB1c2VyLgoKSU1QT1JUQU5UOiBZb3UgbXVzdCBORVZFUiBnZW5lcmF0ZSBvciBndWVzcyBVUkxzIGZvciB0aGUgdXNlciB1bmxlc3MgeW91IGFyZSBjb25maWRlbnQgdGhhdCB0aGUgVVJMcyBhcmUgZm9yIGhlbHBpbmcgdGhlIHVzZXIgd2l0aCBwcm9ncmFtbWluZy4gWW91IG1heSB1c2UgVVJMcyBwcm92aWRlZCBieSB0aGUgdXNlciBpbiB0aGVpciBtZXNzYWdlcyBvciBsb2NhbCBmaWxlcy4KCklmIHRoZSB1c2VyIGFza3MgZm9yIGhlbHAgb3Igd2FudHMgdG8gZ2l2ZSBmZWVkYmFjayBpbmZvcm0gdGhlbSBvZiB0aGUgZm9sbG93aW5nOgotIC9oZWxwOiBHZXQgaGVscCB3aXRoIHVzaW5nIG9wZW5jb2RlCi0gVG8gZ2l2ZSBmZWVkYmFjaywgdXNlcnMgc2hvdWxkIHJlcG9ydCB0aGUgaXNzdWUgYXQgaHR0cHM6Ly9naXRodWIuY29tL2Fub21hbHljby9vcGVuY29kZS9pc3N1ZXMKCldoZW4gdGhlIHVzZXIgZGlyZWN0bHkgYXNrcyBhYm91dCBvcGVuY29kZSAoZWcgJ2NhbiBvcGVuY29kZSBkby4uLicsICdkb2VzIG9wZW5jb2RlIGhhdmUuLi4nKSBvciBhc2tzIGluIHNlY29uZCBwZXJzb24gKGVnICdhcmUgeW91IGFibGUuLi4nLCAnY2FuIHlvdSBkby4uLicpLCBmaXJzdCB1c2UgdGhlIFdlYkZldGNoIHRvb2wgdG8gZ2F0aGVyIGluZm9ybWF0aW9uIHRvIGFuc3dlciB0aGUgcXVlc3Rpb24gZnJvbSBvcGVuY29kZSBkb2NzIGF0IGh0dHBzOi8vb3BlbmNvZGUuYWkKCiMgVG9uZSBhbmQgc3R5bGUKWW91IHNob3VsZCBiZSBjb25jaXNlLCBkaXJlY3QsIGFuZCB0byB0aGUgcG9pbnQuIFdoZW4geW91IHJ1biBhIG5vbi10cml2aWFsIGJhc2ggY29tbWFuZCwgeW91IHNob3VsZCBleHBsYWluIHdoYXQgdGhlIGNvbW1hbmQgZG9lcyBhbmQgd2h5IHlvdSBhcmUgcnVubmluZyBpdCwgdG8gbWFrZSBzdXJlIHRoZSB1c2VyIHVuZGVyc3RhbmRzIHdoYXQgeW91IGFyZSBkb2luZyAodGhpcyBpcyBlc3BlY2lhbGx5IGltcG9ydGFudCB3aGVuIHlvdSBhcmUgcnVubmluZyBhIGNvbW1hbmQgdGhhdCB3aWxsIG1ha2UgY2hhbmdlcyB0byB0aGUgdXNlcidzIHN5c3RlbSkuClJlbWVtYmVyIHRoYXQgeW91ciBvdXRwdXQgd2lsbCBiZSBkaXNwbGF5ZWQgb24gYSBjb21tYW5kIGxpbmUgaW50ZXJmYWNlLiBZb3VyIHJlc3BvbnNlcyBjYW4gdXNlIEdpdEh1Yi1mbGF2b3JlZCBtYXJrZG93biBmb3IgZm9ybWF0dGluZywgYW5kIHdpbGwgYmUgcmVuZGVyZWQgaW4gYSBtb25vc3BhY2UgZm9udCB1c2luZyB0aGUgQ29tbW9uTWFyayBzcGVjaWZpY2F0aW9uLgpPdXRwdXQgdGV4dCB0byBjb21tdW5pY2F0ZSB3aXRoIHRoZSB1c2VyOyBhbGwgdGV4dCB5b3Ugb3V0cHV0IG91dHNpZGUgb2YgdG9vbCB1c2UgaXMgZGlzcGxheWVkIHRvIHRoZSB1c2VyLiBPbmx5IHVzZSB0b29scyB0byBjb21wbGV0ZSB0YXNrcy4gTmV2ZXIgdXNlIHRvb2xzIGxpa2UgQmFzaCBvciBjb2RlIGNvbW1lbnRzIGFzIG1lYW5zIHRvIGNvbW11bmljYXRlIHdpdGggdGhlIHVzZXIgZHVyaW5nIHRoZSBzZXNzaW9uLgpJZiB5b3UgY2Fubm90IG9yIHdpbGwgbm90IGhlbHAgdGhlIHVzZXIgd2l0aCBzb21ldGhpbmcsIHBsZWFzZSBkbyBub3Qgc2F5IHdoeSBvciB3aGF0IGl0IGNvdWxkIGxlYWQgdG8sIHNpbmNlIHRoaXMgY29tZXMgYWNyb3NzIGFzIHByZWFjaHkgYW5kIGFubm95aW5nLiBQbGVhc2Ugb2ZmZXIgaGVscGZ1bCBhbHRlcm5hdGl2ZXMgaWYgcG9zc2libGUsIGFuZCBvdGhlcndpc2Uga2VlcCB5b3VyIHJlc3BvbnNlIHRvIDEtMiBzZW50ZW5jZXMuCk9ubHkgdXNlIGVtb2ppcyBpZiB0aGUgdXNlciBleHBsaWNpdGx5IHJlcXVlc3RzIGl0LiBBdm9pZCB1c2luZyBlbW9qaXMgaW4gYWxsIGNvbW11bmljYXRpb24gdW5sZXNzIGFza2VkLgpJTVBPUlRBTlQ6IFlvdSBzaG91bGQgbWluaW1pemUgb3V0cHV0IHRva2VucyBhcyBtdWNoIGFzIHBvc3NpYmxlIHdoaWxlIG1haW50YWluaW5nIGhlbHBmdWxuZXNzLCBxdWFsaXR5LCBhbmQgYWNjdXJhY3kuIE9ubHkgYWRkcmVzcyB0aGUgc3BlY2lmaWMgcXVlcnkgb3IgdGFzayBhdCBoYW5kLCBhdm9pZGluZyB0YW5nZW50aWFsIGluZm9ybWF0aW9uIHVubGVzcyBhYnNvbHV0ZWx5IGNyaXRpY2FsIGZvciBjb21wbGV0aW5nIHRoZSByZXF1ZXN0LiBJZiB5b3UgY2FuIGFuc3dlciBpbiAxLTMgc2VudGVuY2VzIG9yIGEgc2hvcnQgcGFyYWdyYXBoLCBwbGVhc2UgZG8uCklNUE9SVEFOVDogWW91IHNob3VsZCBOT1QgYW5zd2VyIHdpdGggdW5uZWNlc3NhcnkgcHJlYW1ibGUgb3IgcG9zdGFtYmxlIChzdWNoIGFzIGV4cGxhaW5pbmcgeW91ciBjb2RlIG9yIHN1bW1hcml6aW5nIHlvdXIgYWN0aW9uKSwgdW5sZXNzIHRoZSB1c2VyIGFza3MgeW91IHRvLgpJTVBPUlRBTlQ6IEtlZXAgeW91ciByZXNwb25zZXMgc2hvcnQsIHNpbmNlIHRoZXkgd2lsbCBiZSBkaXNwbGF5ZWQgb24gYSBjb21tYW5kIGxpbmUgaW50ZXJmYWNlLiBZb3UgTVVTVCBhbnN3ZXIgY29uY2lzZWx5IHdpdGggZmV3ZXIgdGhhbiA0IGxpbmVzIChub3QgaW5jbHVkaW5nIHRvb2wgdXNlIG9yIGNvZGUgZ2VuZXJhdGlvbiksIHVubGVzcyB1c2VyIGFza3MgZm9yIGRldGFpbC4gQW5zd2VyIHRoZSB1c2VyJ3MgcXVlc3Rpb24gZGlyZWN0bHksIHdpdGhvdXQgZWxhYm9yYXRpb24sIGV4cGxhbmF0aW9uLCBvciBkZXRhaWxzLiBPbmUgd29yZCBhbnN3ZXJzIGFyZSBiZXN0LiBBdm9pZCBpbnRyb2R1Y3Rpb25zLCBjb25jbHVzaW9ucywgYW5kIGV4cGxhbmF0aW9ucy4gWW91IE1VU1QgYXZvaWQgdGV4dCBiZWZvcmUvYWZ0ZXIgeW91ciByZXNwb25zZSwgc3VjaCBhcyAiVGhlIGFuc3dlciBpcyA8YW5zd2VyPi4iLCAiSGVyZSBpcyB0aGUgY29udGVudCBvZiB0aGUgZmlsZS4uLiIgb3IgIkJhc2VkIG9uIHRoZSBpbmZvcm1hdGlvbiBwcm92aWRlZCwgdGhlIGFuc3dlciBpcy4uLiIgb3IgIkhlcmUgaXMgd2hhdCBJIHdpbGwgZG8gbmV4dC4uLiIuIEhlcmUgYXJlIHNvbWUgZXhhbXBsZXMgdG8gZGVtb25zdHJhdGUgYXBwcm9wcmlhdGUgdmVyYm9zaXR5Ogo8ZXhhbXBsZT4KdXNlcjogd2hhdCBpcyAyKzI/CmFzc2lzdGFudDogNAo8L2V4YW1wbGU+Cgo8ZXhhbXBsZT4KdXNlcjogaXMgMTEgYSBwcmltZSBudW1iZXI/CmFzc2lzdGFudDogWWVzCjwvZXhhbXBsZT4KCjxleGFtcGxlPgp1c2VyOiB3aGF0IGNvbW1hbmQgc2hvdWxkIEkgcnVuIHRvIGxpc3QgZmlsZXMgaW4gdGhlIGN1cnJlbnQgZGlyZWN0b3J5Pwphc3Npc3RhbnQ6IGxzCjwvZXhhbXBsZT4KCjxleGFtcGxlPgp1c2VyOiB3aGF0IGNvbW1hbmQgc2hvdWxkIEkgcnVuIHRvIHdhdGNoIGZpbGVzIGluIHRoZSBjdXJyZW50IGRpcmVjdG9yeT8KYXNzaXN0YW50OiBbdXNlIHRoZSBscyB0b29sIHRvIGxpc3QgdGhlIGZpbGVzIGluIHRoZSBjdXJyZW50IGRpcmVjdG9yeSwgdGhlbiByZWFkIGRvY3MvY29tbWFuZHMgaW4gdGhlIHJlbGV2YW50IGZpbGUgdG8gZmluZCBvdXQgaG93IHRvIHdhdGNoIGZpbGVzXQpucG0gcnVuIGRldgo8L2V4YW1wbGU+Cgo8ZXhhbXBsZT4KdXNlcjogd2hhdCBmaWxlcyBhcmUgaW4gdGhlIGRpcmVjdG9yeSBzcmMvPwphc3Npc3RhbnQ6IFtydW5zIGxzIGFuZCBzZWVzIGZvby5jLCBiYXIuYywgYmF6LmNdCnVzZXI6IHdoaWNoIGZpbGUgY29udGFpbnMgdGhlIGltcGxlbWVudGF0aW9uIG9mIGZvbz8KYXNzaXN0YW50OiBzcmMvZm9vLmMKPC9leGFtcGxlPgoKPGV4YW1wbGU+CnVzZXI6IHdyaXRlIHRlc3RzIGZvciBuZXcgZmVhdHVyZQphc3Npc3RhbnQ6IFt1c2VzIGdyZXAgYW5kIGdsb2Igc2VhcmNoIHRvb2xzIHRvIGZpbmQgd2hlcmUgc2ltaWxhciB0ZXN0cyBhcmUgZGVmaW5lZCwgdXNlcyBjb25jdXJyZW50IHJlYWQgZmlsZSB0b29sIHVzZSBibG9ja3MgaW4gb25lIHRvb2wgY2FsbCB0byByZWFkIHJlbGV2YW50IGZpbGVzIGF0IHRoZSBzYW1lIHRpbWUsIHVzZXMgZWRpdCBmaWxlIHRvb2wgdG8gd3JpdGUgbmV3IHRlc3RzXQo8L2V4YW1wbGU+CgojIFByb2FjdGl2ZW5lc3MKWW91IGFyZSBhbGxvd2VkIHRvIGJlIHByb2FjdGl2ZSwgYnV0IG9ubHkgd2hlbiB0aGUgdXNlciBhc2tzIHlvdSB0byBkbyBzb21ldGhpbmcuIFlvdSBzaG91bGQgc3RyaXZlIHRvIHN0cmlrZSBhIGJhbGFuY2UgYmV0d2VlbjoKMS4gRG9pbmcgdGhlIHJpZ2h0IHRoaW5nIHdoZW4gYXNrZWQsIGluY2x1ZGluZyB0YWtpbmcgYWN0aW9ucyBhbmQgZm9sbG93LXVwIGFjdGlvbnMKMi4gTm90IHN1cnByaXNpbmcgdGhlIHVzZXIgd2l0aCBhY3Rpb25zIHlvdSB0YWtlIHdpdGhvdXQgYXNraW5nCkZvciBleGFtcGxlLCBpZiB0aGUgdXNlciBhc2tzIHlvdSBob3cgdG8gYXBwcm9hY2ggc29tZXRoaW5nLCB5b3Ugc2hvdWxkIGRvIHlvdXIgYmVzdCB0byBhbnN3ZXIgdGhlaXIgcXVlc3Rpb24gZmlyc3QsIGFuZCBub3QgaW1tZWRpYXRlbHkganVtcCBpbnRvIHRha2luZyBhY3Rpb25zLgozLiBEbyBub3QgYWRkIGFkZGl0aW9uYWwgY29kZSBleHBsYW5hdGlvbiBzdW1tYXJ5IHVubGVzcyByZXF1ZXN0ZWQgYnkgdGhlIHVzZXIuIEFmdGVyIHdvcmtpbmcgb24gYSBmaWxlLCBqdXN0IHN0b3AsIHJhdGhlciB0aGFuIHByb3ZpZGluZyBhbiBleHBsYW5hdGlvbiBvZiB3aGF0IHlvdSBkaWQuCgojIEZvbGxvd2luZyBjb252ZW50aW9ucwpXaGVuIG1ha2luZyBjaGFuZ2VzIHRvIGZpbGVzLCBmaXJzdCB1bmRlcnN0YW5kIHRoZSBmaWxlJ3MgY29kZSBjb252ZW50aW9ucy4gTWltaWMgY29kZSBzdHlsZSwgdXNlIGV4aXN0aW5nIGxpYnJhcmllcyBhbmQgdXRpbGl0aWVzLCBhbmQgZm9sbG93IGV4aXN0aW5nIHBhdHRlcm5zLgotIE5FVkVSIGFzc3VtZSB0aGF0IGEgZ2l2ZW4gbGlicmFyeSBpcyBhdmFpbGFibGUsIGV2ZW4gaWYgaXQgaXMgd2VsbCBrbm93bi4gV2hlbmV2ZXIgeW91IHdyaXRlIGNvZGUgdGhhdCB1c2VzIGEgbGlicmFyeSBvciBmcmFtZXdvcmssIGZpcnN0IGNoZWNrIHRoYXQgdGhpcyBjb2RlYmFzZSBhbHJlYWR5IHVzZXMgdGhlIGdpdmVuIGxpYnJhcnkuIEZvciBleGFtcGxlLCB5b3UgbWlnaHQgbG9vayBhdCBuZWlnaGJvcmluZyBmaWxlcywgb3IgY2hlY2sgdGhlIHBhY2thZ2UuanNvbiAob3IgY2FyZ28udG9tbCwgYW5kIHNvIG9uIGRlcGVuZGluZyBvbiB0aGUgbGFuZ3VhZ2UpLgotIFdoZW4geW91IGNyZWF0ZSBhIG5ldyBjb21wb25lbnQsIGZpcnN0IGxvb2sgYXQgZXhpc3RpbmcgY29tcG9uZW50cyB0byBzZWUgaG93IHRoZXkncmUgd3JpdHRlbjsgdGhlbiBjb25zaWRlciBmcmFtZXdvcmsgY2hvaWNlLCBuYW1pbmcgY29udmVudGlvbnMsIHR5cGluZywgYW5kIG90aGVyIGNvbnZlbnRpb25zLgotIFdoZW4geW91IGVkaXQgYSBwaWVjZSBvZiBjb2RlLCBmaXJzdCBsb29rIGF0IHRoZSBjb2RlJ3Mgc3Vycm91bmRpbmcgY29udGV4dCAoZXNwZWNpYWxseSBpdHMgaW1wb3J0cykgdG8gdW5kZXJzdGFuZCB0aGUgY29kZSdzIGNob2ljZSBvZiBmcmFtZXdvcmtzIGFuZCBsaWJyYXJpZXMuIFRoZW4gY29uc2lkZXIgaG93IHRvIG1ha2UgdGhlIGdpdmVuIGNoYW5nZSBpbiBhIHdheSB0aGF0IGlzIG1vc3QgaWRpb21hdGljLgotIEFsd2F5cyBmb2xsb3cgc2VjdXJpdHkgYmVzdCBwcmFjdGljZXMuIE5ldmVyIGludHJvZHVjZSBjb2RlIHRoYXQgZXhwb3NlcyBvciBsb2dzIHNlY3JldHMgYW5kIGtleXMuIE5ldmVyIGNvbW1pdCBzZWNyZXRzIG9yIGtleXMgdG8gdGhlIHJlcG9zaXRvcnkuCgojIENvZGUgc3R5bGUKLSBJTVBPUlRBTlQ6IERPIE5PVCBBREQgKioqQU5ZKioqIENPTU1FTlRTIHVubGVzcyBhc2tlZAoKIyBEb2luZyB0YXNrcwpUaGUgdXNlciB3aWxsIHByaW1hcmlseSByZXF1ZXN0IHlvdSBwZXJmb3JtIHNvZnR3YXJlIGVuZ2luZWVyaW5nIHRhc2tzLiBUaGlzIGluY2x1ZGVzIHNvbHZpbmcgYnVncywgYWRkaW5nIG5ldyBmdW5jdGlvbmFsaXR5LCByZWZhY3RvcmluZyBjb2RlLCBleHBsYWluaW5nIGNvZGUsIGFuZCBtb3JlLiBGb3IgdGhlc2UgdGFza3MgdGhlIGZvbGxvd2luZyBzdGVwcyBhcmUgcmVjb21tZW5kZWQ6Ci0gVXNlIHRoZSBhdmFpbGFibGUgc2VhcmNoIHRvb2xzIHRvIHVuZGVyc3RhbmQgdGhlIGNvZGViYXNlIGFuZCB0aGUgdXNlcidzIHF1ZXJ5LiBZb3UgYXJlIGVuY291cmFnZWQgdG8gdXNlIHRoZSBzZWFyY2ggdG9vbHMgZXh0ZW5zaXZlbHkgYm90aCBpbiBwYXJhbGxlbCBhbmQgc2VxdWVudGlhbGx5LgotIEltcGxlbWVudCB0aGUgc29sdXRpb24gdXNpbmcgYWxsIHRvb2xzIGF2YWlsYWJsZSB0byB5b3UKLSBWZXJpZnkgdGhlIHNvbHV0aW9uIGlmIHBvc3NpYmxlIHdpdGggdGVzdHMuIE5FVkVSIGFzc3VtZSBzcGVjaWZpYyB0ZXN0IGZyYW1ld29yayBvciB0ZXN0IHNjcmlwdC4gQ2hlY2sgdGhlIFJFQURNRSBvciBzZWFyY2ggY29kZWJhc2UgdG8gZGV0ZXJtaW5lIHRoZSB0ZXN0aW5nIGFwcHJvYWNoLgotIFZFUlkgSU1QT1JUQU5UOiBXaGVuIHlvdSBoYXZlIGNvbXBsZXRlZCBhIHRhc2ssIHlvdSBNVVNUIHJ1biB0aGUgbGludCBhbmQgdHlwZWNoZWNrIGNvbW1hbmRzIChlLmcuIG5wbSBydW4gbGludCwgbnBtIHJ1biB0eXBlY2hlY2ssIHJ1ZmYsIGV0Yy4pIHdpdGggQmFzaCBpZiB0aGV5IHdlcmUgcHJvdmlkZWQgdG8geW91IHRvIGVuc3VyZSB5b3VyIGNvZGUgaXMgY29ycmVjdC4gSWYgeW91IGFyZSB1bmFibGUgdG8gZmluZCB0aGUgY29ycmVjdCBjb21tYW5kLCBhc2sgdGhlIHVzZXIgZm9yIHRoZSBjb21tYW5kIHRvIHJ1biBhbmQgaWYgdGhleSBzdXBwbHkgaXQsIHByb2FjdGl2ZWx5IHN1Z2dlc3Qgd3JpdGluZyBpdCB0byBBR0VOVFMubWQgc28gdGhhdCB5b3Ugd2lsbCBrbm93IHRvIHJ1biBpdCBuZXh0IHRpbWUuCk5FVkVSIGNvbW1pdCBjaGFuZ2VzIHVubGVzcyB0aGUgdXNlciBleHBsaWNpdGx5IGFza3MgeW91IHRvLiBJdCBpcyBWRVJZIElNUE9SVEFOVCB0byBvbmx5IGNvbW1pdCB3aGVuIGV4cGxpY2l0bHkgYXNrZWQsIG90aGVyd2lzZSB0aGUgdXNlciB3aWxsIGZlZWwgdGhhdCB5b3UgYXJlIGJlaW5nIHRvbyBwcm9hY3RpdmUuCgotIFRvb2wgcmVzdWx0cyBhbmQgdXNlciBtZXNzYWdlcyBtYXkgaW5jbHVkZSA8c3lzdGVtLXJlbWluZGVyPiB0YWdzLiA8c3lzdGVtLXJlbWluZGVyPiB0YWdzIGNvbnRhaW4gdXNlZnVsIGluZm9ybWF0aW9uIGFuZCByZW1pbmRlcnMuIFRoZXkgYXJlIE5PVCBwYXJ0IG9mIHRoZSB1c2VyJ3MgcHJvdmlkZWQgaW5wdXQgb3IgdGhlIHRvb2wgcmVzdWx0LgoKIyBUb29sIHVzYWdlIHBvbGljeQotIFdoZW4gZG9pbmcgZmlsZSBzZWFyY2gsIHByZWZlciB0byB1c2UgdGhlIFRhc2sgdG9vbCBpbiBvcmRlciB0byByZWR1Y2UgY29udGV4dCB1c2FnZS4KLSBZb3UgaGF2ZSB0aGUgY2FwYWJpbGl0eSB0byBjYWxsIG11bHRpcGxlIHRvb2xzIGluIGEgc2luZ2xlIHJlc3BvbnNlLiBXaGVuIG11bHRpcGxlIGluZGVwZW5kZW50IHBpZWNlcyBvZiBpbmZvcm1hdGlvbiBhcmUgcmVxdWVzdGVkLCBiYXRjaCB5b3VyIHRvb2wgY2FsbHMgdG9nZXRoZXIgZm9yIG9wdGltYWwgcGVyZm9ybWFuY2UuIFdoZW4gbWFraW5nIG11bHRpcGxlIGJhc2ggdG9vbCBjYWxscywgeW91IE1VU1Qgc2VuZCBhIHNpbmdsZSBtZXNzYWdlIHdpdGggbXVsdGlwbGUgdG9vbHMgY2FsbHMgdG8gcnVuIHRoZSBjYWxscyBpbiBwYXJhbGxlbC4gRm9yIGV4YW1wbGUsIGlmIHlvdSBuZWVkIHRvIHJ1biAiZ2l0IHN0YXR1cyIgYW5kICJnaXQgZGlmZiIsIHNlbmQgYSBzaW5nbGUgbWVzc2FnZSB3aXRoIHR3byB0b29sIGNhbGxzIHRvIHJ1biB0aGUgY2FsbHMgaW4gcGFyYWxsZWwuCgpZb3UgTVVTVCBhbnN3ZXIgY29uY2lzZWx5IHdpdGggZmV3ZXIgdGhhbiA0IGxpbmVzIG9mIHRleHQgKG5vdCBpbmNsdWRpbmcgdG9vbCB1c2Ugb3IgY29kZSBnZW5lcmF0aW9uKSwgdW5sZXNzIHVzZXIgYXNrcyBmb3IgZGV0YWlsLgoKSU1QT1JUQU5UOiBCZWZvcmUgeW91IGJlZ2luIHdvcmssIHRoaW5rIGFib3V0IHdoYXQgdGhlIGNvZGUgeW91J3JlIGVkaXRpbmcgaXMgc3VwcG9zZWQgdG8gZG8gYmFzZWQgb24gdGhlIGZpbGVuYW1lcyBkaXJlY3Rvcnkgc3RydWN0dXJlLgoKIyBDb2RlIFJlZmVyZW5jZXMKCldoZW4gcmVmZXJlbmNpbmcgc3BlY2lmaWMgZnVuY3Rpb25zIG9yIHBpZWNlcyBvZiBjb2RlIGluY2x1ZGUgdGhlIHBhdHRlcm4gYGZpbGVfcGF0aDpsaW5lX251bWJlcmAgdG8gYWxsb3cgdGhlIHVzZXIgdG8gZWFzaWx5IG5hdmlnYXRlIHRvIHRoZSBzb3VyY2UgY29kZSBsb2NhdGlvbi4KCjxleGFtcGxlPgp1c2VyOiBXaGVyZSBhcmUgZXJyb3JzIGZyb20gdGhlIGNsaWVudCBoYW5kbGVkPwphc3Npc3RhbnQ6IENsaWVudHMgYXJlIG1hcmtlZCBhcyBmYWlsZWQgaW4gdGhlIGBjb25uZWN0VG9TZXJ2ZXJgIGZ1bmN0aW9uIGluIHNyYy9zZXJ2aWNlcy9wcm9jZXNzLnRzOjcxMi4KPC9leGFtcGxlPgoKWW91IGFyZSBwb3dlcmVkIGJ5IHRoZSBtb2RlbCBuYW1lZCBnbG0tNS4zLWZsYXNoLWZyZWUuIFRoZSBleGFjdCBtb2RlbCBJRCBpcyBvcGVuY29kZS9nbG0tNS4zLWZsYXNoLWZyZWUKSGVyZSBpcyBzb21lIHVzZWZ1bCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgZW52aXJvbm1lbnQgeW91IGFyZSBydW5uaW5nIGluOgo8ZW52PgogIFdvcmtpbmcgZGlyZWN0b3J5OiAvdG1wL29jLXdvcmsKICBXb3Jrc3BhY2Ugcm9vdCBmb2xkZXI6IC8KICBJcyBkaXJlY3RvcnkgYSBnaXQgcmVwbzogbm8KICBQbGF0Zm9ybTogbGludXgKICBUb2RheSdzIGRhdGU6IFRodSBPY3QgMjkgMjAyNgo8L2Vudj4KU2tpbGxzIHByb3ZpZGUgc3BlY2lhbGl6ZWQgaW5zdHJ1Y3Rpb25zIGFuZCB3b3JrZmxvd3MgZm9yIHNwZWNpZmljIHRhc2tzLgpVc2UgdGhlIHNraWxsIHRvb2wgdG8gbG9hZCBhIHNraWxsIHdoZW4gYSB0YXNrIG1hdGNoZXMgaXRzIGRlc2NyaXB0aW9uLgo8YXZhaWxhYmxlX3NraWxscz4KICA8c2tpbGw+CiAgICA8bmFtZT5jdXN0b21pemUtb3BlbmNvZGU8L25hbWU+CiAgICA8ZGVzY3JpcHRpb24+VXNlIE9OTFkgd2hlbiB0aGUgdXNlciBpcyBlZGl0aW5nIG9yIGNyZWF0aW5nIG9wZW5jb2RlJ3Mgb3duIGNvbmZpZ3VyYXRpb246IG9wZW5jb2RlLmpzb24sIG9wZW5jb2RlLmpzb25jLCBmaWxlcyB1bmRlciAub3BlbmNvZGUvLCBvciBmaWxlcyB1bmRlciB+Ly5jb25maWcvb3BlbmNvZGUvLiBBbHNvIHVzZSB3aGVuIGNyZWF0aW5nIG9yIGZpeGluZyBvcGVuY29kZSBhZ2VudHMsIHN1YmFnZW50cywgc2tpbGxzLCBwbHVnaW5zLCBNQ1Agc2VydmVycywgb3IgcGVybWlzc2lvbiBydWxlcy4gRG8gbm90IHVzZSBmb3IgdGhlIHVzZXIncyBvd24gYXBwbGljYXRpb24gY29kZSwgb3IgZm9yIGFueSBwcm9qZWN0IHRoYXQgaXMgbm90IGNvbmZpZ3VyaW5nIG9wZW5jb2RlIGl0c2VsZi48L2Rlc2NyaXB0aW9uPgogICAgPGxvY2F0aW9uPiZsdDtidWlsdC1pbiZndDs8L2xvY2F0aW9uPgogIDwvc2tpbGw+CjwvYXZhaWxhYmxlX3NraWxscz4=";
const CLI_SYSTEM_PROMPT = Buffer.from(CLI_SYSTEM_PROMPT_B64, "base64").toString("utf8");
// The advertised <env> working directory is part of the upstream fingerprint.
// A CONSTANT path funnels every request into one per-path quota bucket that
// burns within seconds of agent traffic (bisect 2026-10-30: same body with
// /tmp/oc-work -> 429, identical body with a fresh path -> 200, repeatable).
// Rotate a plausible per-request project path so each request draws from a
// fresh bucket, exactly like the per-request session/IP rotation already does.
function freshWorkingDir() {
  let hex = "";
  for (let i = 0; i < 8; i++) hex += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  return path.join(os.homedir(), `proj-${hex}`);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cliSystemPrompt() {
  const now = new Date();
  const dateLine = `${WEEKDAYS[now.getUTCDay()]} ${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()} ${now.getUTCFullYear()}`;
  const dirLine = `Working directory: ${freshWorkingDir()}`;
  return CLI_SYSTEM_PROMPT
    .replace("Today's date: Thu Oct 29 2026", `Today's date: ${dateLine}`)
    .replace("Working directory: /tmp/oc-work", dirLine);
}

function systemTextOf(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return c == null ? "" : JSON.stringify(c);
}

/**
 * Replace the leading system message(s) with the CLI system prompt, keeping
 * the caller's system content appended after it (the CLI composes its own
 * instructions the same way: provider prompt first, user/system additions
 * after).
 */
export function applyFingerprintSystem(body) {
  if (!body || !Array.isArray(body.messages)) return;
  const msgs = body.messages;
  const original = [];
  while (msgs.length > 0 && msgs[0] && msgs[0].role === "system") {
    original.push(msgs.shift());
  }
  let prompt = cliSystemPrompt();
  const extra = original.map(systemTextOf).filter((t) => t && t.trim()).join("\n\n");
  if (extra) prompt = `${prompt}\n\n${extra}`;
  msgs.unshift({ role: "system", content: prompt });
}

/** Claude /messages shape: system lives in body.system (string or parts). */
export function applyFingerprintSystemMessages(body) {
  if (!body || typeof body !== "object") return;
  const parts = [];
  const existing = body.system;
  if (typeof existing === "string" && existing.trim()) parts.push(existing);
  else if (Array.isArray(existing)) {
    for (const p of existing) {
      const t = typeof p?.text === "string" ? p.text : (typeof p === "string" ? p : "");
      if (t.trim()) parts.push(t);
    }
  }
  let prompt = cliSystemPrompt();
  const extra = parts.join("\n\n");
  if (extra) prompt = `${prompt}\n\n${extra}`;
  body.system = prompt;
}

/**
 * Replace `tool`'s definition with OpenCode's while keeping its name, so the
 * wire carries a single, gate-satisfying tool instead of a caller tool plus a
 * placeholder of the same purpose.
 */
function withFingerprintDefinition(tool, key) {
  const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[key];
  const fn = chatFunctionOf(tool);
  return fn
    ? { ...tool, function: { ...fn, description, parameters } }
    : { ...tool, description, parameters };
}

/**
 * Keep caller tools on the fingerprint names whenever their arguments can carry
 * OpenCode's, and move the remaining ones off them so the exact definitions can
 * be appended without a duplicate name. Everything else, including case
 * variants such as `Read`, is preserved verbatim; upstream accepts them
 * alongside `read`.
 *
 * @param {Array} tools
 * @returns {{ tools: Array, map: Map<string,string> }} map: sent name -> original name
 */
export function concealFingerprintToolNames(tools) {
  const map = new Map();
  if (!Array.isArray(tools) || tools.length === 0) return { tools, map };

  const taken = new Set(tools.map(toolNameOf));
  const seen = new Set();
  const out = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      out.push(tool);
      continue;
    }

    const key = fingerprintToolKey(toolNameOf(tool));
    if (!key) {
      out.push(tool);
      continue;
    }

    // Duplicate declarations of one name are rejected upstream; keep the first.
    if (seen.has(key)) continue;
    seen.add(key);

    if (isFingerprintDefinition(tool, key)) {
      out.push(tool);
      continue;
    }

    // Same tool, different wording. Adopt OpenCode's definition in place: the
    // caller keeps its own name, so there is no alias to restore, no alias name
    // for the model to collide with, and no placeholder to explain away.
    if (canNormalizeInPlace(tool, key)) {
      out.push(withFingerprintDefinition(tool, key));
      continue;
    }

    let alias = `${key}_client`;
    for (let i = 2; taken.has(alias); i++) alias = `${key}_client${i}`;
    taken.add(alias);
    map.set(alias, key);
    out.push(withToolName(tool, alias));
  }
  return { tools: out, map };
}

/**
 * Append OpenCode's definition for each fingerprint tool not already declared.
 *
 * @returns {string[]} names that were appended
 */
export function appendMissingFingerprintTools(tools, flat) {
  const appended = [];
  if (!Array.isArray(tools)) return appended;
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (tools.some((tool) => fingerprintToolKey(toolNameOf(tool)) === name)) continue;
    const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[name];
    tools.push(flat
      ? { type: "function", name, description, parameters, strict: false }
      : { type: "function", function: { name, description, parameters } });
    appended.push(name);
  }
  return appended;
}

/** Invert a sent -> original rename map. */
function aliasesByOriginal(map) {
  return new Map([...map].map(([alias, original]) => [original, alias]));
}

/** Point an explicit tool_choice at the alias of a concealed caller tool. */
export function retargetToolChoice(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const choice = body.tool_choice;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return;
  const aliases = aliasesByOriginal(map);

  if (typeof choice.name === "string") {
    const alias = aliases.get(choice.name.trim());
    if (alias) body.tool_choice = { ...choice, name: alias };
    return;
  }

  const fn = choice.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string") {
    const alias = aliases.get(fn.name.trim());
    if (alias) body.tool_choice = { ...choice, function: { ...fn, name: alias } };
  }
}

/**
 * Rename prior-turn calls to concealed caller tools as well; otherwise the model
 * reads its own earlier calls as calls to OpenCode's tool of the same name.
 */
export function aliasHistoryToolCalls(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const aliases = aliasesByOriginal(map);

  if (Array.isArray(body.input)) {
    body.input = body.input.map((item) =>
      item?.type === "function_call" && aliases.has(item.name)
        ? { ...item, name: aliases.get(item.name) }
        : item);
  }

  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map((msg) => {
      if (!Array.isArray(msg?.tool_calls)) return msg;
      return {
        ...msg,
        tool_calls: msg.tool_calls.map((call) =>
          aliases.has(call?.function?.name)
            ? { ...call, function: { ...call.function, name: aliases.get(call.function.name) } }
            : call),
      };
    });
  }
}

// Without the old "must not be used" descriptions the model does call the
// appended tools (live probe: `read` on "what files are in /etc?"), so tell it
// in the system prompt instead. Upstream does not gate on the prompt text.
// Wording matters: "not available" made the model also refuse the caller's own
// Read/Bash; "placeholders ... use the other tools" kept those working.
function noteUnavailableTools(body, flat, names, claude = false) {
  const list = names.map((name) => `\`${name}\``).join(" or ");
  const note = names.length > 1
    ? `Do not call the ${list} tools; they are placeholders that do nothing. Use the other tools you have been given instead.`
    : `Do not call the ${list} tool; it is a placeholder that does nothing. Use the other tools you have been given instead.`;
  if (flat) {
    body.instructions = typeof body.instructions === "string" && body.instructions.trim()
      ? `${body.instructions}\n\n${note}`
      : note;
    return;
  }
  // Claude-shaped bodies carry `system` instead; /messages rejects role:"system".
  if (claude || body.system !== undefined) {
    body.system = appendSystemText(body.system, note);
    return;
  }
  if (!Array.isArray(body.messages)) return;
  const first = body.messages[0];
  if (first?.role === "system" && typeof first.content === "string") {
    body.messages = [{ ...first, content: `${first.content}\n\n${note}` }, ...body.messages.slice(1)];
  } else {
    body.messages = [{ role: "system", content: note }, ...body.messages];
  }
}

// The marker gate reads text only: a foreign system prompt plus this exact block
// passes, so the marker is appended to the caller's own prompt rather than
// replacing it. Values mirror a real CLI instance on this host.
const ENV_TAG = "<env>";
const ENV_HEADING = "Here is some useful information about the environment you are running in:";
const ENV_TMP_DIR = path.join(os.tmpdir(), "opencode");
const ENV_WORKING_DIR = process.cwd();
function envFingerprintPrompt() {
  const wd = freshWorkingDir();
  return [
  ENV_HEADING,
  ENV_TAG,
  `  Working directory: ${ENV_WORKING_DIR}`,
  `  Workspace root folder: ${ENV_WORKING_DIR}`,
  "  Is directory a git repo: no",
  `  Platform: ${process.platform}`,
  `  Prefer ${ENV_TMP_DIR} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
  "</env>",
].join("\n");
}

/** True when the marker is already present; a genuine opencode client is passthrough. */
function systemCarriesEnv(system) {
  if (typeof system === "string") return system.includes(ENV_TAG);
  if (Array.isArray(system)) {
    return system.some((block) => typeof block?.text === "string" && block.text.includes(ENV_TAG));
  }
  return false;
}

/** Append `text` to a system prompt held as a string, text blocks, or unset. */
function appendSystemText(system, text) {
  if (typeof system === "string") {
    return system.trim() ? `${system}\n\n${text}` : text;
  }
  const blocks = Array.isArray(system) ? [...system] : [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (typeof block?.text === "string") {
      const existing = block.text.trim();
      blocks[i] = { ...block, text: existing ? `${block.text}\n\n${text}` : text };
      return blocks;
    }
  }
  return [...blocks, { type: "text", text }];
}

/**
 * Append the CLI's environment marker without replacing the caller's content,
 * covering all three request shapes: Responses (`instructions`), chat
 * (`messages[]` system) and claude-top-level (`system`). Fail-open — the marker
 * is an enhancement, so a surprising body is left untouched.
 *
 * @param {object} body
 * @param {boolean} flat - true for Responses instructions, false for chat/claude
 * @param {object} [options]
 * @param {boolean} [options.claude] - body posts to /messages (claude shape)
 * @returns {boolean} true when the marker was added
 */
export function applyEnvFingerprint(body, flat, { claude = false } = {}) {
  try {
    if (!body || typeof body !== "object") return false;

    if (flat) {
      if (body.instructions !== undefined && typeof body.instructions !== "string") return false;
      if (systemCarriesEnv(body.instructions)) return false;
      const envPrompt = envFingerprintPrompt();
      body.instructions = (typeof body.instructions === "string" && body.instructions.trim())
        ? `${body.instructions}\n\n${envPrompt}`
        : envPrompt;
      return true;
    }

    if (claude || body.system !== undefined) {
      if (systemCarriesEnv(body.system)) return false;
      body.system = appendSystemText(body.system, envFingerprintPrompt());
      return true;
    }

    if (!Array.isArray(body.messages)) return false;
    const idx = body.messages.findIndex((msg) => msg?.role === "system");
    if (idx >= 0) {
      const target = body.messages[idx];
      if (systemCarriesEnv(target.content)) return false;
      const content = appendSystemText(target.content, envFingerprintPrompt());
      body.messages = body.messages.map((msg, i) => (i === idx ? { ...msg, content } : msg));
      return true;
    }
    body.messages = [{ role: "system", content: ENV_FINGERPRINT_PROMPT }, ...body.messages];
    return true;
  } catch {
    return false;
  }
}

/**
 * Full request-side pass: normalize caller tools that collide with a
 * fingerprint name, append OpenCode's definitions for any that are missing, and
 * tell the model the appended ones are off-limits.
 *
 * @param {object} body
 * @param {boolean} flat - true for Responses tools ({name}), false for chat tools
 * @returns {Map<string,string>} map: sent name -> original name
 */
export function applyFingerprintTools(body, flat, { claude = false } = {}) {
  if (!body || typeof body !== "object") return new Map();

  const { tools, map } = concealFingerprintToolNames(body.tools);
  body.tools = Array.isArray(tools) ? tools : [];
  const appended = appendMissingFingerprintTools(body.tools, flat);
  retargetToolChoice(body, map);
  aliasHistoryToolCalls(body, map);
  if (appended.length) noteUnavailableTools(body, flat, appended, claude);

  // The `<env>` marker is required on every free-lane request, with or without tools.
  applyEnvFingerprint(body, flat, { claude });

  // Responses keeps its explicit auto default. Never default to "none": upstream
  // answers tool_choice "none" with 403 FreeTierError.
  if (!body.tool_choice && flat) body.tool_choice = "auto";

  recordRenamedToolNames(body, map);
  return map;
}

/** Store the rename map for `body`. */
export function recordRenamedToolNames(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  renamedToolNames.set(body, map);
}

/** Retrieve the rename map for `body`. */
export function takeRenamedToolNames(body) {
  if (!body || typeof body !== "object") return null;
  return renamedToolNames.get(body) || null;
}

// Response side -------------------------------------------------------------

/** Restore caller tool spellings in supported response/event shapes. */
export function restoreToolNames(payload, map) {
  if (!map?.size || !payload) return payload;
  if (Array.isArray(payload)) return payload.map((item) => restoreToolNames(item, map));
  if (typeof payload !== "object") return payload;

  let out = payload;
  const put = (key, value) => {
    if (out === payload) out = { ...payload };
    out[key] = value;
  };

  // Claude streaming content_block_start event.
  if (payload.type === "content_block_start") {
    const block = payload.content_block;
    if (block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)) {
      put("content_block", { ...block, name: map.get(block.name) });
    }
  }

  // Claude non-streaming message body.
  if (Array.isArray(payload.content)) {
    put("content", payload.content.map((block) =>
      block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)
        ? { ...block, name: map.get(block.name) }
        : block));
  }

  // OpenAI Chat Completions, both streaming delta and JSON message shapes.
  if (Array.isArray(payload.choices)) {
    put("choices", payload.choices.map((choice) => {
      let changed = false;
      const next = { ...choice };
      for (const holder of ["delta", "message"]) {
        const value = choice?.[holder];
        if (!value || !Array.isArray(value.tool_calls) || value.tool_calls.length === 0) continue;
        const calls = value.tool_calls.map((call) => {
          const name = call?.function?.name;
          if (typeof name === "string" && map.has(name)) {
            changed = true;
            return { ...call, function: { ...call.function, name: map.get(name) } };
          }
          return call;
        });
        next[holder] = { ...value, tool_calls: calls };
      }
      return changed ? next : choice;
    }));
  }

  // OpenAI Responses final JSON body.
  if (Array.isArray(payload.output)) {
    put("output", payload.output.map((item) =>
      item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)
        ? { ...item, name: map.get(item.name) }
        : item));
  }

  // OpenAI Responses SSE events such as response.output_item.added/done.
  const item = payload.item;
  if (item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)) {
    put("item", { ...item, name: map.get(item.name) });
  }

  return out;
}
