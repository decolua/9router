# 04 — Restore the gemini provider credential

**What to build:** The `gemini` provider answers requests instead of rejecting every
one of them. Its stored credential is currently rejected upstream as invalid, so the
combo entry that uses it fails on every request and always falls through. This is an
operations task — replace or re-authorize the credential, confirm the provider serves
a real request, and confirm the dashboard reports it healthy.

Worth doing regardless of the combo work: while this entry is broken, every request
through a combo containing it pays a wasted round trip.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The gemini connection serves a real chat request end to end
- [ ] The dashboard shows the connection as active with no error state
- [ ] A combo containing a gemini entry can be answered by that entry
