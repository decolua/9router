# Homebrew distribution

9Router's official macOS distribution is the `decolua/homebrew-9router` tap.
The tap packages the immutable npm tarball already published for the CLI; it
does not build the dashboard from a Git checkout or fetch packages from npm
during `brew install`.

## Install and manage

```bash
brew tap decolua/9router
brew install 9router
9router

brew update
brew upgrade 9router
brew info 9router
brew uninstall 9router
```

`brew uninstall` preserves user data under `~/.9router`. Remove that directory
separately only when the user intends to discard providers, settings, and local
data.

## Architecture

The Formula downloads a versioned npm tarball, verifies SHA-256, installs it in
Homebrew's `libexec`, and wraps the existing `cli.js` entrypoint with
Homebrew's Node dependency. This is the best current fit: the published CLI is
a prebuilt JavaScript/Next.js application, its npm `bin` is already `9router`,
and no platform-specific compilation is needed.

The result is architecture-neutral JavaScript. Homebrew supplies native Node
for the host, so the same Formula supports Apple Silicon and Intel Macs without
architecture-specific URLs or checksum branches.

Homebrew Formula class names must be valid Ruby constants, while `9router`
cannot be one. The tap therefore uses canonical `Formula/nine-router.rb` and a
committed `Aliases/9router` symlink. The alias preserves the public commands in
this guide, including `brew install 9router` and `brew info 9router`.

We reject `npm install -g` in the Formula because it resolves mutable registry
dependencies at installation time. We also reject building from Git because it
would make every install compile the dashboard. The separately maintained tap
can generate reviewable Formula PRs from immutable npm artifacts instead.

## Release and maintenance

Publish npm first, confirm `npm view 9router version`, and then publish the
GitHub Release. The application workflow dispatches the tap; the tap reads npm
as the artifact authority, computes SHA-256, runs Homebrew audit/install/test,
and opens a PR for maintainer review. A six-hour tap schedule repairs a missed
dispatch or a temporary registry delay.

Set `HOMEBREW_TAP_DISPATCH_TOKEN` in this repository as a fine-grained token
permitted to dispatch `decolua/homebrew-9router`. The tap itself uses its
repository-scoped `GITHUB_TOKEN` to open the PR. Never place either token in a
Formula or release artifact.

The current published `0.5.40` package needs one pinned compatibility resource
for `node-machine-id`. Future packages bundle declared CLI runtime dependencies;
the `prepack` verification added to `cli/package.json` refuses to publish a
package missing those dependencies.

For breaking CLI changes, retain `9router --version`, document migration in the
release notes, and migrate `~/.9router` explicitly when its data format changes.
To roll back, revert the tap PR or submit a new Formula revision pointing to a
previous immutable npm tarball and SHA-256; never republish a versioned tarball.

## Future migration

If 9Router publishes standalone binaries, Go/Rust builds, pkg installers, or
notarized macOS binaries, replace the Formula implementation while keeping the
same formula name and tap. Users continue to run `brew install 9router`.

The expected path is npm tarball now, architecture-specific binary URLs when
native builds exist, and signed/notarized macOS artifacts if they are shipped.
A `.pkg` should normally become a Cask only when it installs a GUI application
or needs installer behavior a Formula cannot reproduce safely; retain the
Formula for the CLI otherwise.

## References

- [Homebrew: How to Create and Maintain a Tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [Homebrew Formula API](https://rubydoc.brew.sh/Formula)
