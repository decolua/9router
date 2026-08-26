# 02 — Combo skip filters respect real account quota and real reset times

**What to build:** A combo entry stops being passed over while accounts that can
serve it still have quota. Three things currently conspire to hide a healthy
provider behind a stale in-memory verdict:

*It ignores the accounts.* A quota error from whichever account happened to be
picked bans the model process-wide for an hour. Every other account of that
provider — including ones with untouched quota, ones whose window has since reset,
ones re-enabled or added in the meantime — is passed over for the rest of that hour.
The router already keeps precise per-account, per-model locks with true reset times
when it selects credentials; the cascade's ban is a second, coarser verdict layered
on top that never consults them. After this ticket the cascade defers to that
knowledge: an entry is skipped only when no account can currently serve it.

*The ban outlives the outage.* A ban should last until the provider says quota
returns, not a fixed hour chosen in advance.

*The router re-arms the ban with its own error.* When every account is locked, the
router answers with a synthesized message that quotes the provider's original text.
That message is then read back as fresh evidence of quota exhaustion and extends the
ban. It should not be treated as a new provider verdict.

Separately, the context-window filter counts the request's output budget against the
model's input window. For providers whose output allowance is separate from input
context, that is simply wrong, and it silently removes 200k-window entries from long
sessions once the transcript grows past roughly two thirds of the window. The filter
should weigh input against the input window.

The user-visible result: a combo whose Antigravity entries have quota routes to them,
instead of falling through to entries far down the list.

**Blocked by:** 01 — needs the single skip-decision point.

**Status:** ready-for-agent

- [ ] An entry is skipped only when no account of that provider can currently serve
      that model; if any account is free, the entry is attempted
- [ ] A newly added, re-enabled, or freshly reset account makes a banned entry
      eligible again without waiting out a fixed timer
- [ ] A quota ban expires at the provider's reported reset time when one is known
- [ ] The router's own "all accounts locked" response does not extend or create a ban
- [ ] A long request still reaches a model whose input window fits the input, whatever
      output budget the client asked for
- [ ] Models whose input window genuinely cannot fit the request are still skipped
- [ ] The engine stays provider-agnostic — account knowledge is supplied by the caller,
      and the cascade behaves as it does today when none is supplied
- [ ] The three corresponding regression cases pass and leave the known-fails list
