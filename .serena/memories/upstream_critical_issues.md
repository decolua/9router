# Upstream Critical Issues Tracker

**Last Updated**: 2026-01-12  
**Review Period**: 2025-10 to 2026-01 (v6.6.96 - v6.6.102)  
**Next Review**: 2026-02-01 (Monthly Quick Check)

---

## Overview

This file tracks critical and high-priority issues from CLIProxyAPI upstream that require action in 9router. Issues are prioritized using the decision matrix:

**Priority Thresholds:**
- **P0 - Critical**: Score ≥ 8.0 (address within 1 week)
- **P1 - High**: Score 6.0-7.9 (address within 2-4 weeks)
- **P2 - Medium**: Score 4.0-5.9 (address within 1-2 months)
- **P3 - Low**: Score < 4.0 (defer or skip)

**Scoring Formula:**
```
Score = (Severity × 0.4) + (User Impact × 0.3) + (Effort × 0.2) + (Applicability × 0.1)
```

Where each factor is scored 0-10.

---

## Active Critical Issues (P0)

### CRITICAL-001: Memory Leaks in Production Streaming

**Source**: CLIProxyAPI v6.6.96 release notes  
**Upstream Commit**: Multiple commits addressing memory leaks  
**Discovery Date**: 2026-01-12  
**Priority**: P0 - Critical  
**Score**: 9.2 (Severity: 10, User Impact: 10, Effort: 6, Applicability: 10)

**Description:**
Upstream identified and fixed memory leaks causing OOM (Out of Memory) crashes in Kubernetes deployments during long-running streaming sessions. The leaks were in streaming response handlers that failed to properly clean up resources.

**Impact on 9router:**
- **Severity**: Critical - Could cause service crashes in production
- **Affected Components**: 
  - `open-sse/handlers/chatCore.js` - Main streaming handler
  - `open-sse/executors/default.js` - HTTP executor with fetch calls
  - `open-sse/utils/streamHandler.js` - Stream management
  - `open-sse/utils/stream.js` - Transform streams
- **User Experience**: Service crashes, interrupted streams, data loss
- **Deployment Risk**: High for production VPS deployments with multiple concurrent users

**9router Status**: ⚠️ UNKNOWN - Not yet tested

**Root Cause Hypothesis:**
- Transform streams not being properly closed on connection abort
- Event listeners not being removed after stream completion
- Fetch AbortController signals not propagating to all cleanup handlers
- Response objects retained in memory after stream ends

**Action Items:**
- [ ] **Week 1**: Load test streaming endpoints with memory profiling
  - Test scenario: 10+ concurrent long-running streams (5+ minutes each)
  - Monitor: RSS memory growth over time using `ps -p PID -o rss,vsz`
  - Tool: `NODE_OPTIONS="--max-old-space-size=512" npm run dev`
  - Expected: Memory should plateau, not grow continuously
- [ ] **Week 1**: Review stream cleanup in chatCore.js
  - Verify all transform streams have proper cleanup in 'close' and 'error' events
  - Check for removeListener calls for all addEventListener calls
  - Ensure AbortController.abort() propagates to all async operations
- [ ] **Week 1**: Review executor cleanup in default.js
  - Verify fetch() AbortSignal is properly wired
  - Check response.body cleanup on errors
  - Ensure no dangling promises after request completion
- [ ] **Week 2**: Implement upstream fixes if leaks found
  - Port Go cleanup patterns to JavaScript/Node.js context
  - Add explicit .destroy() calls on all streams
  - Add try/finally blocks to ensure cleanup
- [ ] **Week 2**: Regression test with load testing
- [ ] **Week 2**: Update this issue status to RESOLVED

**Timeline**: 1-2 weeks (Critical)

**Related Files:**
- `/home/doublefx/projects/9router/open-sse/handlers/chatCore.js:1-500`
- `/home/doublefx/projects/9router/open-sse/executors/default.js:1-200`
- `/home/doublefx/projects/9router/open-sse/utils/streamHandler.js:1-150`
- `/home/doublefx/projects/9router/open-sse/utils/stream.js:1-100`

**GitHub Issue**: TBD (create after initial investigation)

---

## Active High-Priority Issues (P1)

### P1-001: Context Cancellation Handling

**Source**: CLIProxyAPI v6.6.94 release notes  
**Upstream Commit**: Context cancellation improvements  
**Discovery Date**: 2026-01-12  
**Priority**: P1 - High  
**Score**: 7.4 (Severity: 7, User Impact: 7, Effort: 8, Applicability: 10)

**Description:**
Upstream improved context cancellation handling to ensure resources are properly cleaned up when requests are aborted mid-stream. Previous implementation left hanging connections and unclosed file handles.

**Impact on 9router:**
- **Severity**: High - Resource exhaustion over time
- **Affected Components**:
  - `open-sse/executors/base.js` - Base executor
  - `open-sse/executors/default.js` - Default executor with fetch
  - `src/sse/handlers/chat.js` - SSE handler
- **User Experience**: Slower performance over time, eventual service degradation
- **Deployment Risk**: Medium for long-running instances

**9router Status**: ⚠️ UNKNOWN - Needs review

**Root Cause Hypothesis:**
- Undici fetch cancellation may not propagate to all cleanup handlers
- AbortSignal not being passed down to all async operations
- Transform stream pipeline not handling abort events
- Promise chains not being cancelled properly

**Action Items:**
- [ ] **Week 1**: Review AbortController usage
  - Check all fetch() calls have { signal: controller.signal }
  - Verify AbortSignal propagates through transform streams
  - Ensure all async operations respect AbortSignal
- [ ] **Week 1**: Test request abortion scenarios
  - Test: Client disconnects mid-stream
  - Test: Timeout during streaming
  - Test: Manual cancellation via AbortController
  - Verify: No hanging connections (use `netstat -an | grep ESTABLISHED`)
  - Verify: All event listeners removed
  - Verify: All file handles closed (use `lsof -p PID`)
- [ ] **Week 2**: Review server logs for proper cleanup messages
- [ ] **Week 2-3**: Implement missing cancellation handlers if needed
- [ ] **Week 3**: Regression test with abort scenarios
- [ ] **Week 3**: Update status to RESOLVED

**Timeline**: 2-3 weeks

**Related Files:**
- `/home/doublefx/projects/9router/open-sse/executors/base.js:1-150`
- `/home/doublefx/projects/9router/open-sse/executors/default.js:1-200`
- `/home/doublefx/projects/9router/src/sse/handlers/chat.js:1-100`

**GitHub Issue**: TBD

---

### P1-002: Claude OAuth Tool Name Mapping

**Source**: CLIProxyAPI v6.6.95 release notes  
**Upstream Commit**: Fixed Claude OAuth tool call mappings  
**Discovery Date**: 2026-01-12  
**Priority**: P1 - High  
**Score**: 6.8 (Severity: 7, User Impact: 7, Effort: 7, Applicability: 8)

**Description:**
Upstream fixed bugs in Claude OAuth tool name mapping where tool calls were not being correctly translated between OpenAI and Claude formats. This affected users using Claude OAuth with tools/function calling.

**Impact on 9router:**
- **Severity**: High - Breaks tool calling functionality
- **Affected Components**:
  - `open-sse/translator/claude/helpers/toolCallHelper.js` - Tool call translation
  - `open-sse/translator/claude/request.js` - Request translator
  - `open-sse/translator/claude/response.js` - Response translator
- **User Experience**: Tools not executing, incorrect tool calls, errors
- **Deployment Risk**: Low (only affects users using tools with Claude OAuth)

**9router Status**: ⚠️ VERIFY - May already be correct, needs testing

**Root Cause Hypothesis:**
- Tool name mapping may use incorrect field names
- Response translation may not handle all tool call formats
- Missing edge cases for nested tool calls

**Action Items:**
- [ ] **Week 1**: Review toolCallHelper.js implementation
  - Compare with upstream Go implementation
  - Check field name mappings (name, function.name, etc.)
  - Verify both request and response translation
- [ ] **Week 1**: Test Claude OAuth with tools
  - Test case: Simple tool call (get_weather)
  - Test case: Multiple tool calls in parallel
  - Test case: Nested tool results
  - Test case: Tool call errors
  - Verify: Correct tool execution
  - Verify: Correct response formatting
- [ ] **Week 2**: Compare with non-OAuth Claude (should work identically)
- [ ] **Week 2**: Fix any discrepancies found
- [ ] **Week 2**: Add integration tests for tool calls
- [ ] **Week 2**: Update status to RESOLVED or VERIFIED

**Timeline**: 2 weeks

**Related Files:**
- `/home/doublefx/projects/9router/open-sse/translator/claude/helpers/toolCallHelper.js:1-200`
- `/home/doublefx/projects/9router/open-sse/translator/claude/request.js:1-300`
- `/home/doublefx/projects/9router/open-sse/translator/claude/response.js:1-300`

**GitHub Issue**: TBD

---

## Active Medium-Priority Issues (P2)

### P2-001: Amp CLI Compatibility

**Source**: CLIProxyAPI recent updates (v6.6.100+)  
**Upstream Commits**: Multiple Amp CLI compatibility fixes  
**Discovery Date**: 2026-01-12  
**Priority**: P2 - Medium  
**Score**: 4.9 (Severity: 4, User Impact: 4, Effort: 6, Applicability: 8)

**Description:**
Upstream added and improved compatibility with Amp CLI, a popular AI coding assistant. Amp CLI has specific requirements for API responses and authentication flows.

**Impact on 9router:**
- **Severity**: Medium - Limits user base
- **Affected Components**: Unknown - needs investigation
- **User Experience**: Amp CLI users cannot use 9router
- **Deployment Risk**: Low (only affects Amp CLI users)

**9router Status**: ❓ UNKNOWN - Not yet investigated

**Action Items:**
- [ ] **Week 1-2**: Research Amp CLI
  - What is Amp CLI? (documentation, GitHub repo)
  - How does it authenticate? (API key, OAuth, other)
  - What API format does it expect? (OpenAI-compatible?)
  - What special headers/behaviors does it need?
- [ ] **Week 3**: Test Amp CLI with 9router
  - Install Amp CLI
  - Configure to point to 9router
  - Test basic chat completions
  - Test streaming
  - Test with multiple providers
- [ ] **Week 4**: Document compatibility status
  - If works: Mark as ✅ PARITY in feature_parity_matrix.md
  - If doesn't work: Document specific issues
  - Create GitHub issue if fixes needed
- [ ] **Month 2**: Implement fixes if needed

**Timeline**: 1-2 months

**Related Files**: TBD (after investigation)

**GitHub Issue**: TBD

---

### P2-002: Codex Integration Improvements

**Source**: CLIProxyAPI recent updates (v6.6.98-v6.6.102)  
**Upstream Commits**: Codex parameter handling, instruction override  
**Discovery Date**: 2026-01-12  
**Priority**: P2 - Medium  
**Score**: 4.2 (Severity: 4, User Impact: 3, Effort: 7, Applicability: 7)

**Description:**
Upstream improved Codex integration with better parameter handling and instruction override capabilities. These are quality-of-life improvements for Codex users.

**Impact on 9router:**
- **Severity**: Medium - Limits Codex functionality
- **Affected Components**:
  - `open-sse/translator/codex/` - Codex translator
  - Codex provider configuration
- **User Experience**: Codex users may miss features or get suboptimal results
- **Deployment Risk**: Low (only affects Codex users)

**9router Status**: 🔄 PARTIAL - Basic Codex support exists, enhancements may be missing

**Action Items:**
- [ ] **Week 1**: Review upstream Codex changes
  - Read release notes for v6.6.98-v6.6.102
  - Identify specific Codex improvements
  - List parameter changes
  - List instruction override features
- [ ] **Week 2**: Compare with 9router Codex implementation
  - Check which parameters are supported
  - Check instruction handling
  - Identify gaps
- [ ] **Week 3-4**: Implement missing features if valuable
- [ ] **Month 2**: Test with Codex users

**Timeline**: 1-2 months

**Related Files:**
- `/home/doublefx/projects/9router/open-sse/translator/codex/*`
- `/home/doublefx/projects/9router/open-sse/config/providerModels.js` (Codex config)

**GitHub Issue**: TBD

---

## Performance & Optimization (P2-P3)

### P2-003: Performance Optimizations

**Source**: CLIProxyAPI ongoing improvements  
**Priority**: P2 - Medium  
**Score**: 4.0 (Severity: 3, User Impact: 5, Effort: 4, Applicability: 6)

**Description:**
Upstream has made various performance optimizations over recent releases. These are generally Go-specific (goroutines, memory pools) but concepts may apply.

**Impact on 9router:**
- **Severity**: Low - Performance is acceptable
- **Affected Components**: Various
- **User Experience**: Slightly slower response times
- **Deployment Risk**: Low

**9router Status**: ⏳ DEFER - Performance is adequate for current needs

**Action Items:**
- [ ] Defer until user reports performance issues
- [ ] Review during next quarterly review
- [ ] Focus on critical issues first

**Timeline**: Deferred

---

## Resolved Issues

*(Issues will be moved here once addressed and verified)*

### Example Format:
```markdown
### ✅ RESOLVED-001: Issue Title

**Resolution Date**: YYYY-MM-DD
**Original Priority**: P0/P1/P2/P3
**Resolution Summary**: Brief description of how it was fixed
**Verification**: How it was tested/verified
**GitHub Issue**: Link to issue
**Related PR**: Link to pull request
```

---

## Issue Management Workflow

### Adding New Issues

When new upstream releases are reviewed (monthly/quarterly):

1. **Identify Issue**:
   - Scan release notes for critical keywords: "critical", "security", "memory", "leak", "crash", "fix"
   - Read issue description and impact

2. **Score Issue** using decision matrix:
   - Severity: Critical=10, High=7, Medium=4, Low=2
   - User Impact: All users=10, Many=7, Few=4, None=1
   - Effort: Easy=10, Medium=6, Hard=2, Very Hard=1
   - Applicability: Fully applicable=10, Partially=5, Not applicable=0

3. **Classify Priority**:
   - P0 (≥8.0): Add to "Active Critical Issues"
   - P1 (6.0-7.9): Add to "Active High-Priority Issues"
   - P2 (4.0-5.9): Add to "Active Medium-Priority Issues"
   - P3 (<4.0): Document but defer

4. **Fill Template**:
   - Source, Priority, Score, Description, Impact, Status, Action Items, Timeline, Related Files

5. **Create GitHub Issue** for P0/P1 items:
   - Title: `[Upstream] Issue description`
   - Labels: `upstream`, `bug` or `enhancement`, `P0-critical` or `P1-high`
   - Link to upstream issue/commit
   - Link to this memory file entry

### Resolving Issues

When an issue is fixed:

1. **Complete Action Items**: Check off all items in action list
2. **Test & Verify**: Run verification tests, document results
3. **Update Status**: Change status to ✅ RESOLVED
4. **Move to Resolved Section**: Cut from active section, paste into resolved with resolution details
5. **Update Feature Parity Matrix**: Update relevant entries in feature_parity_matrix.md
6. **Close GitHub Issue**: Close with link to PR and verification notes
7. **Update Upstream Tracking**: Note resolution in upstream_tracking.md

---

## Review Checklist

Use this checklist during monthly/quarterly reviews:

### Monthly Quick Check (30-60 minutes)
- [ ] Fetch latest upstream releases (last 30 days)
- [ ] Scan for critical keywords: "critical", "security", "memory", "leak", "crash"
- [ ] If critical issue found:
  - [ ] Add to this file with proper priority
  - [ ] Create P0 GitHub issue
  - [ ] Notify team
- [ ] Update "Last Updated" date at top of file

### Quarterly Deep Dive (4-6 hours)
- [ ] Review all releases since last quarter
- [ ] Re-score existing issues (priorities may change)
- [ ] Move stale issues to lower priority or close
- [ ] Verify all P0 issues have been addressed
- [ ] Check progress on P1 issues
- [ ] Update action items with current status
- [ ] Run security audit (see security-audit.sh)
- [ ] Update all 4 upstream tracking memories
- [ ] Create GitHub issues for new P0/P1 items

---

## Statistics

**Current Status** (2026-01-12):
- Active P0 Issues: 1 (Memory Leaks)
- Active P1 Issues: 2 (Context Cancellation, Claude OAuth Tool Mapping)
- Active P2 Issues: 3 (Amp CLI, Codex Improvements, Performance)
- Active P3 Issues: 0
- Resolved Issues: 0

**Priority Distribution**:
- Critical (P0): 14% (1/7)
- High (P1): 29% (2/7)
- Medium (P2): 43% (3/7)
- Low (P3): 14% (1/7)

**Total Score**: 36.5 (average: 5.2 - High-Medium priority)

---

## Quick Commands

```bash
# Monitor memory usage during load test
NODE_OPTIONS="--max-old-space-size=512" npm run dev &
PID=$!
while true; do ps -p $PID -o rss,vsz,cmd; sleep 30; done

# Check for hanging connections
netstat -an | grep ESTABLISHED | grep :3000

# Check open file handles
lsof -p $(pgrep -f "node.*npm run dev")

# Test request abortion
curl -N -X POST http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Write a very long story"}],"stream":true}' &
sleep 2
killall curl
# Then check server logs for cleanup messages
```

---

## Notes

- This file focuses on **actionable issues** requiring code changes or investigation
- Not all upstream changes are tracked here (language-specific Go changes are ignored)
- Issues are re-prioritized during quarterly reviews as context changes
- Security issues are automatically P0 regardless of score
- User-reported issues should be cross-referenced with this file to check if upstream fixed them

**Last Review**: 2026-01-12 (Initial baseline)  
**Next Review**: 2026-02-01 (Monthly)  
**Next Deep Dive**: 2026-04-12 (Quarterly)