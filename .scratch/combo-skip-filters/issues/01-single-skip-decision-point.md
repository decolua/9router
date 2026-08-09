# 01 — Single skip-decision point in the combo cascade, with visible skips

**What to build:** Every reason the combo cascade passes over one of its entries is
decided in one place and announced in the log at `warn` level, naming the entry and
the reason it was passed over. Today three independent filters — quota exhaustion,
model cooldown, and context-window fit — each decide silently at `info`, so a combo
that answers from its last entry gives no indication that the earlier ones were
never attempted. After this ticket, reading the console is enough to tell which
entries were tried and which were skipped and why.

This is a prefactor: routing behaviour is unchanged. Its purpose is to give tickets
02 and 03 one seam to change instead of three, and to make their effect observable.

The diagnostic harness written during the investigation becomes a permanent
regression test in the unit suite. Its four cases assert the *correct* behaviour and
therefore fail on landing — register them in the baseline known-fails list so
`verify-no-regression.mjs` stays meaningful, and let tickets 02 and 03 retire their
own cases as they go green.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] All skip decisions for a combo entry are made by one function that returns the
      reason, rather than by separate inline checks in the cascade loop
- [ ] A skipped entry is logged at `warn` with the entry name and the reason
- [ ] An attempted entry still logs as it does today
- [ ] The four investigation cases live in the unit suite under a permanent name with
      no debug tags, and are listed in the baseline known-fails file
- [ ] `verify-no-regression.mjs` reports no new failures beyond those four
