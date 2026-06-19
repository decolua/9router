#!/usr/bin/env bash
# Merge selected upstream PRs into dev, tier-ordered.
# - fetches each PR ref from `upstream`
# - merges with --no-ff; on conflict aborts and logs as SKIP
set -uo pipefail

TIER1="1794 1827 1893 1898 1837 1843 1738 1875 1895 1897"
TIER2="1816 1810 1824 1823 1821 1820 1819 1818 1817 1761 1774 1775 1773 1784 1854 1805 1760 1764"
TIER3="1900 1899 1883 1797 1740 1741 1781 1892 1896 1825 1829 1848 1845 1889"

ALL="$TIER1 $TIER2 $TIER3"

# dedupe while preserving order
SEEN=""
ORDERED=""
for pr in $ALL; do
  case " $SEEN " in
    *" $pr "*) ;;
    *) SEEN="$SEEN $pr"; ORDERED="$ORDERED $pr" ;;
  esac
done

mkdir -p .omc/state
MERGED_LOG=.omc/state/upstream-pr-merged.txt
SKIPPED_LOG=.omc/state/upstream-pr-skipped.txt
: > "$MERGED_LOG"
: > "$SKIPPED_LOG"

for pr in $ORDERED; do
  echo "=== PR #$pr ==="
  # fetch PR ref into local branch
  if ! git fetch upstream "pull/$pr/head:pr-$pr" 2>/dev/null; then
    echo "FETCH_FAIL #$pr"
    echo "$pr FETCH_FAIL" >> "$SKIPPED_LOG"
    continue
  fi
  # attempt merge with --no-ff
  TITLE=$(git log -1 --format='%s' "pr-$pr")
  if git merge --no-ff "pr-$pr" -m "merge upstream PR #$pr: $TITLE" >/tmp/merge-$pr.log 2>&1; then
    echo "$pr $TITLE" >> "$MERGED_LOG"
    echo "MERGED #$pr: $TITLE"
  else
    git merge --abort 2>/dev/null || true
    echo "$pr CONFLICT $TITLE" >> "$SKIPPED_LOG"
    echo "CONFLICT #$pr: $TITLE"
  fi
  # cleanup local pr branch
  git branch -D "pr-$pr" >/dev/null 2>&1 || true
done

echo
echo "=== SUMMARY ==="
echo "MERGED: $(wc -l < "$MERGED_LOG")"
echo "SKIPPED: $(wc -l < "$SKIPPED_LOG")"
