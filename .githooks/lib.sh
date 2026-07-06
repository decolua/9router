#!/usr/bin/env bash
# Shared helpers for Investtal git hooks. POSIX-flavoured bash (works on macOS bash 3.2).

# Marker used by the installer to recognise previously-injected chain lines.
IVT_HOOK_MARKER="ivt-hooks-chain"

# Infra branches always allowed regardless of the IVT-XXXX rule.
IVT_ALLOWED_EXACT="main master develop dev"
IVT_ALLOWED_PREFIX="release/ hotfix/"

# IVT task id: IVT- followed by EXACTLY 4 digits (0000-9999), then a
# non-alphanumeric boundary (or end-of-string) so IVT-99999, IVT-0999X, and
# IVT-69696969 are rejected. Group 1 captures the bare id (IVT-XXXX), group 2
# the boundary char. Spelled-out digit classes instead of `{4}` because the
# ERE interval quantifier is unreliable on bash 3.2 (stock macOS).
IVT_TASK_REGEX='(IVT-[0-9][0-9][0-9][0-9])([^[:alnum:]]|$)'

ivt_hook_debug() {
  [ -n "${IVT_HOOK_DEBUG:-}" ] && echo "[ivt-hook] $*" >&2
}

ivt_current_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null
}

ivt_branch_is_infra() {
  local branch="$1"
  [ -z "$branch" ] && return 1

  local allowed
  for allowed in $IVT_ALLOWED_EXACT; do
    [ "$branch" = "$allowed" ] && return 0
  done

  local prefix
  for prefix in $IVT_ALLOWED_PREFIX; do
    case "$branch" in
      ${prefix}*) return 0 ;;
    esac
  done

  return 1
}

# Valid per Investtal policy: an infra branch, OR one containing an IVT-XXXX id.
ivt_branch_is_valid() {
  local branch="$1"
  [ -z "$branch" ] && return 1
  ivt_branch_is_infra "$branch" && return 0
  # shellcheck disable=SC2076
  [[ "$branch" =~ $IVT_TASK_REGEX ]]
}

ivt_print_policy() {
  cat >&2 <<'EOF'

[branch policy] Investtal task-id branch naming is enforced.

  Allowed branch names must be EITHER:
    • an infra branch: main, master, develop, dev, release/*, hotfix/*
    • contain a task id of the form IVT-XXXX (4 digits), e.g.
        IVT-0999
        feat/IVT-0999-broker-view
        IVT-0999-broker-view

  Examples of INVALID names:
    feat/broker-view          (no task id)
    chore/cleanup             (no task id)
    IVT-999                   (only 3 digits — must be 4)
    IVT-0999X                 (extra chars after the 4 digits)
    IVT-69696969              (more than 4 digits)

To create a correctly-named branch from your current one:
    git branch -m IVT-XXXX-short-description
EOF
}

# Extract the bare 4-digit task id ("IVT-0999") from a string, or print empty.
# Group 1 of the regex captures the bare id directly, so no fragile pattern
# stripping (the old `${match%${BASH_REMATCH[1]}}` mis-stripped when the
# boundary char was a glob metacharacter like `*`, `?`, or `[`).
ivt_extract_task_id() {
  local s="$1"
  if [[ "$s" =~ $IVT_TASK_REGEX ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Resolve a (possibly symlinked) path to its absolute, dereferenced target.
# Portable across macOS bash 3.2 (no readlink -f on stock < 12.3), Linux
# (GNU readlink -f), and systems with coreutils (greadlink).
ivt_resolve_symlink() {
  local target="$1"

  if command -v greadlink >/dev/null 2>&1; then
    greadlink -f "$target" 2>/dev/null && return
  fi
  # Stock readlink -f works on Linux and macOS 12.3+. Probe with a known path
  # to avoid emitting an error on BSD readlink (which lacks -f).
  if command -v readlink >/dev/null 2>&1 \
     && readlink -f -- / >/dev/null 2>&1; then
    readlink -f -- "$target" 2>/dev/null && return
  fi

  # Manual fallback: chase symlinks one hop at a time. Bash 3.2-safe.
  local cur="$target"
  local hops=0
  while [ -L "$cur" ] && [ "$hops" -lt 40 ]; do
    hops=$((hops + 1))
    local dir
    dir="$(cd -P "$(dirname "$cur")" >/dev/null 2>&1 && pwd)"
    local link
    link="$(readlink "$cur")"
    case "$link" in
      /*) cur="$link" ;;
      *)  cur="$dir/$link" ;;
    esac
  done
  local d
  d="$(cd -P "$(dirname "$cur")" >/dev/null 2>&1 && pwd)" || { printf '%s\n' "$cur"; return; }
  printf '%s/%s\n' "$d" "$(basename "$cur")"
}

# Absolute directory of the currently-running hook (dereferenced through symlinks).
ivt_hook_dir() {
  local resolved
  resolved="$(ivt_resolve_symlink "$0")"
  dirname "$resolved"
}

# Chain-execute a sibling hook preserved as <name>.pre-ivt (installed by the
# installer), passing the original args. Sibling (not git-path) resolution
# matters because .pre-ivt sits next to our hook, which in husky/vite-hooks
# repos is NOT .git/hooks. Recursion-safe via IVT_HOOK_CHAIN_DEPTH (cap 8).
ivt_chain_next_hook() {
  local hook_name="$1"
  shift

  local depth="${IVT_HOOK_CHAIN_DEPTH:-0}"
  if [ "$depth" -gt 8 ]; then
    ivt_hook_debug "chain depth limit hit at $hook_name, stopping"
    return 0
  fi

  local hooks_dir
  hooks_dir="$(ivt_hook_dir)"
  [ -z "$hooks_dir" ] && return 0

  local previous="$hooks_dir/${hook_name}.pre-ivt"
  if [ -x "$previous" ]; then
    ivt_hook_debug "chaining $previous (depth=$((depth + 1)))"
    IVT_HOOK_CHAIN_DEPTH=$((depth + 1)) "$previous" "$@"
    return $?
  fi
}
