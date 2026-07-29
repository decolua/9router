# Homebrew distribution plan

> **Status: not yet published.** Do not advertise `brew tap decolua/9router`
> or `brew install 9router` until the separate `decolua/homebrew-9router` tap
> is public, its Formula PR is merged, and its checks are green.

## Release prerequisites

1. Create and review the companion `decolua/homebrew-9router` Formula PR.
2. Verify the Formula on Apple Silicon and Intel macOS runners with `brew audit`,
   source install, and `brew test`.
3. Configure `HOMEBREW_TAP_DISPATCH_TOKEN` with permission to dispatch the tap
   workflow before publishing a GitHub Release.
4. Publish npm before the GitHub Release so the dispatcher can read and checksum
   the immutable tarball.

The public install, update, and uninstall commands belong in the tap README
only after those prerequisites are met.

## Architecture

The Formula must download a versioned npm tarball, verify SHA-256, install it in
Homebrew's `libexec`, and wrap the existing `cli.js` entrypoint with Homebrew's
Node dependency. This is the best current fit: the published CLI is a prebuilt
JavaScript/Next.js application, its npm `bin` is already `9router`, and no
platform-specific compilation is needed.

The result is architecture-neutral JavaScript. Homebrew supplies native Node
for the host, so the same Formula supports Apple Silicon and Intel Macs without
architecture-specific URLs or checksum branches.

Homebrew Formula class names must be valid Ruby constants, while `9router`
cannot be one. The tap therefore uses canonical `Formula/nine-router.rb` and a
committed `Aliases/9router` symlink. The alias preserves the eventual public
commands, including `brew install 9router` and `brew info 9router`.

We reject `npm install -g` in the Formula because it resolves mutable registry
dependencies at installation time. We also reject building from Git because it
would make every install compile the dashboard.

## Package ownership and release automation

Homebrew mode uses the wrapper environment marker
`NINEROUTER_PACKAGE_MANAGER=homebrew`. In that mode the CLI must neither run
postinstall/runtime npm installs nor add `~/.9router/runtime` to `NODE_PATH`.
The Formula owns every runtime dependency it needs.

The packed-tarball verifier builds the npm archive, installs it offline with
lifecycle scripts disabled, and runs `9router --version` in Homebrew mode before
publishing. That validates the actual package boundary rather than merely the
source-tree `node_modules` layout.

The application workflow dispatches the tap after a GitHub Release. The tap
reads npm as the artifact authority, computes SHA-256, runs Homebrew
audit/install/test, and opens a PR for maintainer review. A six-hour tap
schedule repairs a missed dispatch or temporary registry delay.

`HOMEBREW_TAP_DISPATCH_TOKEN` is an explicit release prerequisite. It must be a
fine-grained token permitted to dispatch `decolua/homebrew-9router`; without it,
the dispatch workflow intentionally fails. The tap uses its repository-scoped
`GITHUB_TOKEN` to open its own PR. Never put either token in a Formula or
release artifact.

For breaking CLI changes, retain `9router --version`, document migration in the
release notes, and migrate `~/.9router` explicitly when its data format changes.
To roll back, revert the tap PR or submit a new Formula revision pointing to a
previous immutable npm tarball and SHA-256; never republish a versioned tarball.

## Future migration

If 9Router publishes standalone binaries, Go/Rust builds, pkg installers, or
notarized macOS binaries, replace the Formula implementation while keeping the
same formula name and tap. Users continue to run `brew install 9router` once
the tap is published.

The expected path is npm tarball now, architecture-specific binary URLs when
native builds exist, and signed/notarized macOS artifacts if they are shipped.
A `.pkg` should normally become a Cask only when it installs a GUI application
or needs installer behavior a Formula cannot reproduce safely; retain the
Formula for the CLI otherwise.

## References

- [Homebrew: How to Create and Maintain a Tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [Homebrew Formula API](https://rubydoc.brew.sh/Formula)
