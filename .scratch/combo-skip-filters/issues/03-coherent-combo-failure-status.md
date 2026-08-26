# 03 — Combo failure reports a status matching the error it quotes

**What to build:** When every entry in a combo fails, the client gets a status code
that belongs to the error message it is shown. Today the status is taken from the
*first* entry that failed while the message is taken from the *last*, so a client can
receive a status from one provider carrying another provider's explanation — for
example a `410` whose body describes a `400` from a different upstream. The mismatch
is also actively harmful: the borrowed status may be one the client treats as
permanent, so it abandons a request that a retry would have served.

The reported status should describe the failure being quoted, and where the combo
failed for reasons that will pass — every account rate-limited, every provider
briefly unavailable — the client should receive a status it will retry rather than
one it will give up on.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The status returned when all entries fail belongs to the error quoted in the body
- [ ] A combo that failed for transient or rate-limit reasons answers with a status the
      client will retry
- [ ] Retry timing information is still carried when the router knows it
- [ ] The corresponding regression case passes and leaves the known-fails list
