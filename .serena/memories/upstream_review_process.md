# Upstream Review Process & Methodology

**Last Updated**: 2026-01-12  
**Purpose**: Detailed methodology for comparing 9router against CLIProxyAPI upstream  
**Audience**: Developers performing monthly/quarterly reviews

---

## Overview

This document provides the complete methodology for reviewing upstream CLIProxyAPI changes and determining what (if anything) needs to be backported to 9router. This is a **living process** that evolves as we learn what works.

**Key Principles:**
1. **Selective, not comprehensive**: We can't track every commit (1,309+ commits, daily releases)
2. **Functional parity over source parity**: Focus on features/fixes, not code-level matching
3. **JavaScript context matters**: Some Go solutions don't apply to Node.js
4. **User-driven prioritization**: If users aren't reporting issues, we may be fine
5. **Security first**: Security issues are always P0 regardless of scoring

---

## Repository Setup

### Prerequisites

Ensure you have the following tools installed:
- `git` - For repository operations
- `curl` - For GitHub API calls
- `jq` - For JSON parsing (`sudo apt install jq`)
- `node` and `npm` - For running 9router
- Web browser - For manual GitHub review

### Upstream Mirror Setup

**One-time setup** (already completed):

```bash
# Clone upstream as bare repository (space-efficient mirror)
mkdir -p ~/.9router/upstream
cd ~/.9router/upstream
git clone --bare https://github.com/router-for-me/CLIProxyAPI.git mirror

# Create convenience alias for git operations
echo 'alias upstream-git="git --git-dir ~/.9router/upstream/mirror"' >> ~/.bash_aliases
source ~/.bash_aliases

# Verify setup
upstream-git tag -l --sort=-version:refname | head -5
# Should show: v6.6.102, v6.6.101, v6.6.100, etc.
```

**Ongoing maintenance** (quarterly):

```bash
# Update mirror with latest upstream changes
cd ~/.9router/upstream
upstream-git fetch origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'

# Verify latest version
upstream-git tag -l --sort=-version:refname | head -1
```

---

## Decision Matrix for Prioritization

When evaluating an upstream change, score it across 4 dimensions:

### Scoring Dimensions

| Dimension | Weight | Scoring Guide |
|-----------|--------|---------------|
| **Severity** | 40% | Critical=10 (crashes, data loss, security), High=7 (bugs, errors), Medium=4 (UX issues), Low=2 (polish) |
| **User Impact** | 30% | All users=10, Many users=7, Few users=4, Specific edge case=1 |
| **Effort** | 20% | Easy/Quick=10, Medium=6, Hard/Time-consuming=2, Very Hard=1 |
| **Applicability** | 10% | Fully applicable=10, Partially applicable=5, Go-specific=0 |

### Calculation

```
Score = (Severity × 0.4) + (User Impact × 0.3) + (Effort × 0.2) + (Applicability × 0.1)
```

### Priority Thresholds

| Score Range | Priority | SLA | Description |
|-------------|----------|-----|-------------|
| ≥ 8.0 | P0 - Critical | 1 week | Drop everything, fix immediately |
| 6.0-7.9 | P1 - High | 2-4 weeks | Schedule in current sprint |
| 4.0-5.9 | P2 - Medium | 1-2 months | Plan for next release cycle |
| < 4.0 | P3 - Low | Defer | Consider skipping or postponing indefinitely |

### Example Scoring

**Memory Leak (upstream v6.6.96):**
- Severity: 10 (causes OOM crashes)
- User Impact: 10 (affects all users with streaming)
- Effort: 6 (medium - need to understand and test)
- Applicability: 10 (fully applicable to Node.js)
- **Score**: (10 × 0.4) + (10 × 0.3) + (6 × 0.2) + (10 × 0.1) = **9.2** → **P0 Critical**

**New Provider (e.g., new AI service):**
- Severity: 4 (nice to have, not critical)
- User Impact: 4 (only users of that provider)
- Effort: 6 (medium - implement OAuth + translator)
- Applicability: 10 (fully applicable)
- **Score**: (4 × 0.4) + (4 × 0.3) + (6 × 0.2) + (10 × 0.1) = **4.6** → **P2 Medium**

**Go SDK Update:**
- Severity: 2 (low impact)
- User Impact: 1 (doesn't affect users)
- Effort: 10 (easy to skip!)
- Applicability: 0 (not applicable to JavaScript)
- **Score**: (2 × 0.4) + (1 × 0.3) + (10 × 0.2) + (0 × 0.1) = **3.1** → **P3 Low (skip)**

---

## Monthly Quick Check Process

**Time**: 30-60 minutes  
**When**: First Monday of each month  
**Scope**: Critical/security issues only

### Step-by-Step Process

#### 1. Fetch Latest Releases

```bash
# Get last 10 releases via GitHub API
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases?per_page=10" \
  > /tmp/upstream-releases-$(date +%Y%m%d).json

# Quick view of versions and dates
cat /tmp/upstream-releases-$(date +%Y%m%d).json | \
  jq -r '.[] | "\(.tag_name) - \(.published_at) - \(.name)"'
```

**Expected output:**
```
v6.6.102 - 2026-01-10T14:32:00Z - Release v6.6.102
v6.6.101 - 2026-01-09T16:15:00Z - Release v6.6.101
...
```

#### 2. Scan for Critical Keywords

```bash
# Scan release notes for critical patterns
cat /tmp/upstream-releases-$(date +%Y%m%d).json | \
  jq -r '.[] | select(.body | test("critical|security|vulnerability|memory leak|crash|CVE-"; "i")) |
  "\(.tag_name): \(.body[:200])"'
```

**Critical keywords to watch:**
- `critical` - Critical bugs
- `security` - Security vulnerabilities
- `vulnerability` - Security issues
- `CVE-` - Common Vulnerabilities and Exposures
- `memory leak` - Memory management issues
- `crash` - Application crashes
- `panic` - Unhandled errors (Go-specific but serious)
- `data loss` - Data integrity issues
- `corruption` - Data corruption

#### 3. If Critical Issue Found

**a. Read full release notes:**
```bash
# Get detailed release notes for specific version
VERSION="v6.6.102"
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/tags/$VERSION" | \
  jq -r '.body'
```

**b. Understand the issue:**
- What component is affected?
- What is the failure mode?
- What triggers the issue?
- Is it user-visible?
- Is data at risk?

**c. Check applicability to 9router:**
- Does 9router have the affected component?
- Is it implemented the same way?
- Could the same bug exist in JavaScript?

**d. Score the issue** using decision matrix

**e. If P0 or P1:**
```bash
# Add to upstream_critical_issues.md
# Create GitHub issue in 9router repo
# Notify team (if applicable)
```

#### 4. Update Tracking

```bash
# Update last review date in upstream_tracking.md
echo "Last Monthly Review: $(date +%Y-%m-%d)" >> ~/.9router/state/last-monthly-review
```

#### 5. Document in Memory

Update `.serena/memories/upstream_tracking.md`:
- Update "Last Monthly Check" date
- Note any critical issues found (or "No critical issues")

---

## Quarterly Deep Dive Process

**Time**: 4-6 hours  
**When**: January 12, April 12, July 12, October 12  
**Scope**: Comprehensive review of all changes

### Step-by-Step Process

#### Phase 1: Preparation (30 minutes)

**1. Update upstream mirror:**
```bash
cd ~/.9router/upstream
upstream-git fetch origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
```

**2. Determine review range:**
```bash
# Get last quarterly review date
LAST_REVIEW=$(cat ~/.9router/state/last-quarterly-review || echo "$(date -d '3 months ago' +%Y-%m-%d)")
echo "Reviewing from: $LAST_REVIEW to $(date +%Y-%m-%d)"
```

**3. Fetch all releases in range:**
```bash
# Get up to 100 releases (should cover 3 months)
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases?per_page=100" \
  > /tmp/upstream-releases-quarterly-$(date +%Y%m%d).json

# Filter by date range
cat /tmp/upstream-releases-quarterly-$(date +%Y%m%d).json | \
  jq --arg since "$LAST_REVIEW" '[.[] | select(.published_at >= $since)]' \
  > /tmp/upstream-releases-filtered.json

# Count releases
RELEASE_COUNT=$(cat /tmp/upstream-releases-filtered.json | jq 'length')
echo "Found $RELEASE_COUNT releases to review"
```

#### Phase 2: Categorization (2-3 hours)

**1. Create review template:**
```bash
# Use quarterly-review.sh script (created later)
~/.9router/scripts/quarterly-review.sh
```

This creates a markdown file with all releases to categorize.

**2. For each release, determine:**

**a. Category:**
- 🔴 **Critical (P0)**: Security, crashes, data loss, memory leaks
- 🟠 **High Priority (P1)**: Bugs affecting many users, important features
- 🟡 **Medium Priority (P2)**: Nice-to-have features, minor bugs
- 🟢 **Low Priority (P3)**: Polish, optimizations, documentation
- ⚪ **Not Applicable**: Go-specific, build system, upstream-only features

**b. For P0/P1 items, fill out:**
- Issue description (what is the problem?)
- Impact analysis (who is affected? how severe?)
- Root cause (why did it happen?)
- 9router applicability (do we have this issue?)
- Action items (what needs to be done?)
- Timeline (when to address?)

**3. Use GitHub web UI for deeper investigation:**
```bash
# Open release in browser
RELEASE_TAG="v6.6.102"
xdg-open "https://github.com/router-for-me/CLIProxyAPI/releases/tag/$RELEASE_TAG"
```

**4. Find related commits:**
```bash
# List commits between versions
upstream-git log --oneline v6.6.95..v6.6.102

# Search commits by keyword
upstream-git log --grep="memory leak" --oneline

# View specific commit
upstream-git show <commit-hash>
```

**5. Compare Go code with 9router:**
```bash
# Check out specific version to read code
cd ~/.9router/upstream-checkout  # Create if doesn't exist
git clone https://github.com/router-for-me/CLIProxyAPI.git .
git checkout v6.6.102

# Read Go files to understand fix
cat router/handlers/streaming.go
cat translator/claude/tools.go
# etc.
```

#### Phase 3: Update Memories (1 hour)

**1. Update `upstream_tracking.md`:**
- Update "Last Quarterly Review" date
- Update "Upstream Status" (latest version)
- Update "Gap Analysis" section
- Note new features/providers discovered

**2. Update `feature_parity_matrix.md`:**
- Add new providers discovered
- Add new features discovered
- Update status of existing features (✅/⚠️/❌/🎯)
- Update "Gaps Requiring Action" section

**3. Update `upstream_critical_issues.md`:**
- Add all P0/P1 issues with full details
- Update existing issues with new information
- Move resolved issues to "Resolved" section
- Update statistics at bottom

**4. Create GitHub issues for P0/P1:**
```bash
# For each P0/P1 issue, create GitHub issue:
# Title: [Upstream] Memory leaks in streaming handlers
# Labels: upstream, bug, P0-critical
# Body: Link to upstream issue, describe impact, link to memory file
```

#### Phase 4: Security Audit (1-2 hours)

**Run comprehensive security audit:**
```bash
~/.9router/scripts/security-audit.sh
```

**Review findings:**
- Compare with known upstream security fixes
- Check if 9router is vulnerable to upstream CVEs
- Update `security_audit_findings.md` if new issues found

#### Phase 5: Wrap-Up (30 minutes)

**1. Update state files:**
```bash
echo "$(date +%Y-%m-%d)" > ~/.9router/state/last-quarterly-review
```

**2. Schedule next reviews:**
```bash
# Next quarterly: +3 months
# Next monthly: First Monday of next month
```

**3. Team communication:**
- Share summary of findings
- Highlight P0 issues requiring immediate action
- Request review/approval for planned work

---

## Ad-Hoc Review Process

**Time**: 1-3 hours  
**When**: As needed  
**Triggers**:
- User reports compatibility issue with CLI tool
- New provider announcement (e.g., new AI service launch)
- Security vulnerability reported in ecosystem
- Major upstream version jump (e.g., v7.0.0)
- Production issue that might be fixed upstream

### Step-by-Step Process

#### 1. Identify the Specific Issue

```bash
# If user reported issue, gather:
# - What tool/provider?
# - What error message?
# - What expected behavior?
# - When did it start failing?
```

#### 2. Check if Upstream Fixed It

```bash
# Search upstream issues
xdg-open "https://github.com/router-for-me/CLIProxyAPI/issues?q=is%3Aissue+<keyword>"

# Search upstream commits
upstream-git log --grep="<keyword>" --oneline -20

# Search upstream releases
cat /tmp/upstream-releases-quarterly-$(date +%Y%m%d).json | \
  jq -r '.[] | select(.body | test("<keyword>"; "i")) | "\(.tag_name): \(.body[:200])"'
```

#### 3. Compare Implementations

```bash
# Read upstream implementation
cd ~/.9router/upstream-checkout
git log -p --all -S "<keyword>" -- '*.go'

# Compare with 9router
cd ~/projects/9router
grep -r "<keyword>" open-sse/ src/
```

#### 4. Determine Action

**If upstream fixed it:**
- Score using decision matrix
- Add to `upstream_critical_issues.md` with appropriate priority
- Create GitHub issue if P0/P1
- Implement fix

**If upstream doesn't have it:**
- This is a 9router-specific issue
- Debug and fix in 9router
- Consider contributing to upstream if applicable

#### 5. Update Memories

- Add to `upstream_tracking.md` under "Ad-Hoc Reviews" section
- Update relevant entry in `feature_parity_matrix.md`
- Add to `upstream_critical_issues.md` if needs tracking

---

## GitHub API Usage

### Authentication (Optional)

For higher rate limits (5,000 requests/hour vs 60):

```bash
# Create personal access token: https://github.com/settings/tokens
# No special scopes needed for public repos

# Use in requests
curl -H "Authorization: token YOUR_TOKEN" \
  "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases"
```

### Common API Queries

**Get latest release:**
```bash
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest" | jq .
```

**Get specific release:**
```bash
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/tags/v6.6.102" | jq .
```

**Get all releases (paginated):**
```bash
# Page 1 (most recent 100)
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases?per_page=100&page=1" | jq .

# Page 2 (next 100)
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases?per_page=100&page=2" | jq .
```

**Search issues:**
```bash
curl -s "https://api.github.com/search/issues?q=repo:router-for-me/CLIProxyAPI+memory+leak" | jq .
```

**Get commit details:**
```bash
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/commits/<sha>" | jq .
```

**Check rate limit:**
```bash
curl -s "https://api.github.com/rate_limit" | jq .
```

---

## Git Commands Reference

### Listing and Searching

```bash
# List all tags (versions)
upstream-git tag -l

# List tags sorted by version
upstream-git tag -l --sort=-version:refname

# List recent commits
upstream-git log --oneline -20

# Search commits by message
upstream-git log --grep="memory" --oneline

# Search commits by code change
upstream-git log -S "clientSecret" --oneline

# Search commits by file
upstream-git log --oneline -- router/handlers/streaming.go

# Show commit details
upstream-git show <commit-hash>

# Show files changed in commit
upstream-git show --name-only <commit-hash>

# Compare two versions
upstream-git diff v6.6.95..v6.6.102

# List commits between versions
upstream-git log --oneline v6.6.95..v6.6.102

# Count commits between versions
upstream-git rev-list --count v6.6.95..v6.6.102
```

### Analyzing Changes

```bash
# See what changed in a specific file between versions
upstream-git diff v6.6.95..v6.6.102 -- router/handlers/streaming.go

# See commit history for a file
upstream-git log --follow -- router/handlers/streaming.go

# Blame (who changed each line)
upstream-git blame HEAD -- router/handlers/streaming.go
```

### Branches

```bash
# List branches
upstream-git branch -a

# See commits in main branch
upstream-git log origin/main --oneline -20
```

---

## Translation Guide: Go to JavaScript

When backporting upstream Go fixes to 9router JavaScript, consider these differences:

### Concurrency

**Go:**
```go
go func() {
    // Async work in goroutine
}()
```

**JavaScript:**
```javascript
(async () => {
    // Async work
})();
```

### Error Handling

**Go:**
```go
if err != nil {
    return nil, err
}
```

**JavaScript:**
```javascript
try {
    // ...
} catch (error) {
    throw error;
}
```

### Context Cancellation

**Go:**
```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
```

**JavaScript:**
```javascript
const controller = new AbortController();
const signal = controller.signal;
// Later: controller.abort();
```

### Streaming

**Go:**
```go
scanner := bufio.NewScanner(resp.Body)
for scanner.Scan() {
    // Process line
}
```

**JavaScript:**
```javascript
const stream = response.body;
for await (const chunk of stream) {
    // Process chunk
}
```

### Memory Management

**Go:** Explicit defer, garbage collection
**JavaScript:** Garbage collection, explicit `.destroy()` on streams

---

## Automation Strategy

### Scripts to Use

1. **`check-upstream-releases.sh`** - Weekly automated check for new releases
2. **`scan-upstream-criticals.sh`** - Monthly scan for critical patterns
3. **`check-feature-parity.sh`** - Monthly feature comparison
4. **`quarterly-review.sh`** - Quarterly review template generator
5. **`security-audit.sh`** - Security audit after quarterly review

### Cron Schedule

```bash
# Weekly release check (Monday 9 AM)
0 9 * * MON ~/.9router/scripts/check-upstream-releases.sh >> ~/.9router/logs/upstream-check.log 2>&1
```

### Manual Trigger Schedule

- **Monthly** (First Monday): Run `scan-upstream-criticals.sh` and `check-feature-parity.sh`
- **Quarterly** (Jan 12, Apr 12, Jul 12, Oct 12): Run `quarterly-review.sh` then `security-audit.sh`
- **Ad-Hoc** (As needed): Manual git/GitHub investigation

---

## Common Pitfalls

### Pitfall 1: Trying to Track Everything

**Problem**: Upstream has 1,309+ commits, multiple daily releases. Trying to review every commit is overwhelming and unsustainable.

**Solution**: Focus on critical bugs, security, and new features. Ignore language-specific changes (Go SDK updates, build system).

### Pitfall 2: Assuming Direct Applicability

**Problem**: Not all upstream fixes apply to 9router. Go and JavaScript have different strengths and weaknesses.

**Solution**: Always consider applicability score. Ask: "Does this issue exist in Node.js?" Some Go issues (goroutine leaks) don't apply to JavaScript (event loop).

### Pitfall 3: Forgetting to Update Memories

**Problem**: Reviews are useless if findings aren't documented. Memory files become stale.

**Solution**: Always update all 4 memory files after reviews. Set "Last Updated" dates. Make it part of the process checklist.

### Pitfall 4: Skipping the Security Audit

**Problem**: Security issues are easy to miss in release notes. They compound over time.

**Solution**: Run security-audit.sh at the end of every quarterly review. Make it a mandatory step, not optional.

### Pitfall 5: Not Creating GitHub Issues

**Problem**: Findings sit in memory files but no action is taken. P0/P1 issues are forgotten.

**Solution**: For every P0/P1 issue, immediately create a GitHub issue. This ensures tracking and accountability.

---

## Checklist Templates

### Monthly Quick Check Checklist

- [ ] Fetch latest 10 releases via GitHub API
- [ ] Scan for critical keywords
- [ ] If critical issue found:
  - [ ] Read full release notes
  - [ ] Determine applicability to 9router
  - [ ] Score using decision matrix
  - [ ] Add to `upstream_critical_issues.md` if P0/P1
  - [ ] Create GitHub issue if P0/P1
- [ ] Update "Last Monthly Check" in `upstream_tracking.md`
- [ ] Update state file: `~/.9router/state/last-monthly-review`

### Quarterly Deep Dive Checklist

- [ ] Update upstream mirror (`upstream-git fetch`)
- [ ] Determine review date range (last quarter to now)
- [ ] Fetch all releases in range via GitHub API
- [ ] Run `quarterly-review.sh` to generate template
- [ ] Categorize each release (P0/P1/P2/P3/N/A)
- [ ] For P0/P1 issues:
  - [ ] Fill out full issue details
  - [ ] Create GitHub issue
- [ ] Update all 4 memory files:
  - [ ] `upstream_tracking.md`
  - [ ] `feature_parity_matrix.md`
  - [ ] `upstream_critical_issues.md`
  - [ ] `upstream_review_process.md` (if process changes)
- [ ] Run `security-audit.sh`
- [ ] Review security audit findings
- [ ] Update state file: `~/.9router/state/last-quarterly-review`
- [ ] Schedule next reviews (monthly and quarterly)

### Ad-Hoc Review Checklist

- [ ] Identify specific issue/trigger
- [ ] Search upstream issues on GitHub
- [ ] Search upstream commits (`upstream-git log --grep`)
- [ ] Compare implementations (upstream vs 9router)
- [ ] Determine if upstream fixed it
- [ ] Score using decision matrix
- [ ] Add to `upstream_critical_issues.md` if actionable
- [ ] Create GitHub issue if P0/P1
- [ ] Update relevant memory files
- [ ] Document in "Ad-Hoc Reviews" section of `upstream_tracking.md`

---

## Tools and Resources

### Required Tools

- `git` - Repository operations
- `curl` - API calls
- `jq` - JSON parsing
- `grep` - Text searching
- `xdg-open` or `open` - Open browser
- `node` and `npm` - Run 9router for testing

### Optional Tools

- `gh` (GitHub CLI) - Easier issue/PR management
- `gitk` or `tig` - Visual git history
- `diff-so-fancy` - Better diff output
- `notify-send` - Desktop notifications for automation

### External Resources

- Upstream repository: https://github.com/router-for-me/CLIProxyAPI
- Upstream releases: https://github.com/router-for-me/CLIProxyAPI/releases
- Upstream issues: https://github.com/router-for-me/CLIProxyAPI/issues
- GitHub API docs: https://docs.github.com/en/rest
- 9router repository: https://github.com/decolua/9router

---

## Evolution of This Process

This process will evolve over time as we learn what works:

### After First Monthly Review

- [ ] Evaluate: Did we find the right issues?
- [ ] Adjust: Modify critical keyword list if needed
- [ ] Document: Note what worked/didn't work

### After First Quarterly Review

- [ ] Evaluate: Was 4-6 hours sufficient?
- [ ] Adjust: Modify scoring weights if priorities were wrong
- [ ] Improve: Refine categorization criteria
- [ ] Document: Update this process file with lessons learned

### Continuous Improvement

- Track metrics: time spent, issues found, false positives
- Refine automation scripts based on actual usage
- Adjust review frequency if upstream changes pace
- Share findings with team for feedback

---

## Quick Reference Card

**Upstream Mirror:**
```bash
upstream-git tag -l --sort=-version:refname | head -5  # Latest versions
upstream-git log --grep="<keyword>" --oneline          # Search commits
```

**GitHub API:**
```bash
curl -s "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases?per_page=10" | jq .
```

**Decision Matrix:**
```
Score = (Severity × 0.4) + (User Impact × 0.3) + (Effort × 0.2) + (Applicability × 0.1)
P0: ≥8.0  P1: 6.0-7.9  P2: 4.0-5.9  P3: <4.0
```

**Critical Keywords:**
`critical, security, vulnerability, CVE-, memory leak, crash, panic, data loss, corruption`

**Memory Files:**
- `upstream_tracking.md` - Status and review dates
- `feature_parity_matrix.md` - Feature comparison table
- `upstream_critical_issues.md` - Active P0/P1 issues
- `upstream_review_process.md` - This file

**Automation:**
- Weekly: `check-upstream-releases.sh` (cron)
- Monthly: `scan-upstream-criticals.sh`, `check-feature-parity.sh`
- Quarterly: `quarterly-review.sh`, `security-audit.sh`

---

**Last Updated**: 2026-01-12  
**Next Review**: After first quarterly review (2026-04-12)