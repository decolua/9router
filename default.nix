# Non-flake entry point: `nix-build default.nix`.
# Resolves inputs through flake.lock via flake-compat, so the same nixpkgs
# pins apply as in the flake - including the legacy nixpkgs for
# x86_64-darwin, which nixpkgs-unstable no longer supports.
(import
  (fetchTarball {
    url = "https://github.com/NixOS/flake-compat/archive/5edf11c44bc78a0d334f6334cdaf7d60d732daab.tar.gz";
    sha256 = "sha256:0yqfa6rx8md81bcn4szfp0hjq2f3h9i8zjzhqqyfqdkrj5559nmw";
  })
  { src = ./.; }).defaultNix.packages.${builtins.currentSystem}.default
