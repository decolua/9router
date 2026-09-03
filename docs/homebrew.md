# Homebrew distribution plan

> **Status: not yet published.** Do not advertise `brew tap decolua/9router`
> or `brew install 9router` until the separate `decolua/homebrew-9router` tap
> is public, its Formula PR is merged, and its checks are green. The reviewed
> staging implementation is tracked in
> `mythic3011/homebrew-9router#1`; transfer or recreate it under the decolua
> account before enabling the public commands.

## Release prerequisites

1. Transfer or recreate the reviewed staging Formula PR under
   `decolua/homebrew-9router`, then merge it there.
2. Verify the Formula on Apple Silicon and Intel macOS runners with `brew audit`,
   source install, and `brew test`.
3. Configure `HOMEBREW_TAP_DISPATCH_TOKEN` with permission to dispatch the tap
   workflow before publishing a GitHub Release.
4. Publish npm before the GitHub Release so the dispatcher can read and checksum
   the immutable tarball.

After those prerequisites are met, publish this lifecycle documentation:

```bash
brew tap decolua/9router
brew install 9router
brew update
brew upgrade 9router
brew info 9router
brew uninstall 9router
```

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

The current Homebrew mode deliberately disables the macOS tray helper.
`systray2@2.1.4` ships an unsigned x86_64-only executable, so packaging it
would require Rosetta on Apple Silicon and weaken the reproducible native
architecture contract. `--tray` remains a headless server mode for command
compatibility, but it does not create a tray icon in Homebrew installs. The
Formula and CLI tests must verify that Homebrew mode never resolves tray code
from `~/.9router/runtime`. Restore the icon only after 9Router publishes signed
ARM64 and x86_64 tray artifacts or replaces the helper with a native universal
build.

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

OpenAI Codex is a useful reference for the native-artifact stage: its Homebrew
Cask selects architecture-specific release archives and SHA-256 values, exposes
the packaged executable with `binary`, and uses GitHub release tags for
`livecheck`. 9Router should adopt those artifact-selection patterns if it later
ships standalone ARM64 and x86_64 archives, while retaining the Formula name
and `brew install 9router` command unless installer behavior requires a Cask.

## References

- [Homebrew: How to Create and Maintain a Tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [Homebrew Formula API](https://rubydoc.brew.sh/Formula)
- [OpenAI Codex repository](https://github.com/openai/codex)
- [OpenAI Codex Homebrew Cask](https://github.com/Homebrew/homebrew-cask/blob/HEAD/Casks/c/codex.rb)
