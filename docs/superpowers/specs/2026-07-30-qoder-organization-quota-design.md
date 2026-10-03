# Qoder Organization Quota Visibility Spec

## Problem Statement

The quota tracker omits Qoder organization quota records whenever their reported total is zero. Qoder can report meaningful organization usage and remaining credits in that state, so users either cannot see the data or see a finite allocation rendered as unlimited.

## Success Metrics

- 100% of Qoder organization quota records with a non-zero `total`, `used`, or `remaining` value appear as quota tracker rows.
- 100% of Qoder quota records with a zero reported total and meaningful used or remaining credits display a finite inferred total equal to `used + remaining`.
- 100% of all-zero Qoder organization placeholder records remain hidden from the quota tracker.
- Existing focused quota-parser tests pass with zero failures.

## User Stories

- As a Qoder user, I want organization usage returned by 9Router to appear in the quota tracker so that I can see usage beyond my personal allocation.
- As a Qoder user, I want a finite organization allocation to show its actual used, total, and remaining percentage instead of an infinity symbol.
- As a Qoder user without an organization allocation, I do not want an empty organization row cluttering the quota tracker.

## Acceptance Criteria

- [x] Given an organization quota with `total: 0`, `used: 20000`, and `remaining: 0`, the quota tracker includes an `Organization` row with an inferred total of `20000`.
- [x] Given an organization quota with `total: 0`, `used: 3804`, and `remaining: 6196`, the quota tracker displays `3804 / 10000` and `62%` remaining.
- [x] A positive reported total remains authoritative and is not replaced by the inferred total.
- [x] The included organization row preserves its reported usage, unit, and reset time.
- [x] Given an organization quota whose `total`, `used`, and `remaining` values are all zero, the normalized quota output omits the organization row.
- [x] Personal Qoder quota normalization remains unchanged.
- [x] Automated regression tests cover non-zero total, used, and remaining values plus the all-zero placeholder case.

## Non-Goals

- Changing the Qoder upstream request or server-side usage response.
- Changing generic quota percentage calculation or unlimited-quota display behavior.
- Changing normalization for providers other than Qoder.
- Adding dependencies or modifying provider authentication.

## Constraints

- Must use the existing Qoder quota normalization path.
- Must infer a missing Qoder total without forwarding absolute remaining credits through the generic percentage field.
- Must preserve the existing JavaScript and Vitest toolchain.
- Must not add third-party dependencies.
- Test coverage for the changed behavior must be complete.
