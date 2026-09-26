# Fork Notes

This fork follows [`decolua/9router`](https://github.com/decolua/9router) and keeps the upstream repository as the `upstream` remote.

## Contribution in progress

- Base commit: `39e36d3` (`v0.5.86`, 2026-09-23)
- Branch: `fix/pi-settings-preserve-model-caps`
- Related upstream issue: [#4268](https://github.com/decolua/9router/issues/4268)
- Scope: preserve existing Pi provider metadata and unselected models while retaining actual model limits when a Pi settings update is saved.
- Verification: the focused Vitest regression suite for this change passes locally.

No provider credentials, OAuth tokens, personal configurations, or production request data are included in this fork or contribution.

## License and upstream relationship

This fork retains the upstream license and notices. Changes are intended to be small, independently testable, and proposed upstream through the repository's public contribution process.
