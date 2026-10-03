{
  description = "9Router - FREE AI Router & Token Saver CLI + web dashboard";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    # Pin x86_64-darwin to the last nixpkgs release that supports Intel Macs.
    # nixpkgs-unstable dropped x86_64-darwin in 26.11; the -darwin branch
    # receives security updates through end of 2026 without the breaking churn.
    nixpkgs-darwin-legacy.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-darwin-legacy,
      ...
    }:
    let
      allSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      pkgsFor =
        system:
        if system == "x86_64-darwin" then
          import nixpkgs-darwin-legacy {
            inherit system;
            config.allowDeprecatedx86_64Darwin = true;
          }
        else
          nixpkgs.legacyPackages.${system};

      forAllSystems = nixpkgs.lib.genAttrs allSystems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          pkg = pkgs.callPackage ./package.nix { };
        in
        {
          default = pkg;
          "9router" = pkg;
        }
      );

      apps = forAllSystems (system: {
        default = self.apps.${system}."9router";
        "9router" = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/9router";
          meta = self.packages.${system}.default.meta;
        };
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_22
              sqlite # SQLite CLI for inspecting the local DB during dev
              act # local CI validation (test-with-act)
            ];
            shellHook = ''
              echo "9Router development environment (Node.js 22 + npm)"
              echo "Run: npm install && npm run dev"
            '';
          };
        }
      );

      # Overlay so users can add 9router to their pkgs via:
      #   nixpkgs.overlays = [ (builtins.getFlake "github:decolua/9router").overlays.default ];
      overlays.default = _final: prev: {
        "9router" = self.packages.${prev.stdenv.hostPlatform.system}.default;
      };

      # Modules - importable via flake outputs:
      #   inputs.9router.homeModules.default   (home-manager)
      #   inputs.9router.nixosModules.default  (NixOS)
      homeModules = {
        default = ./nix/modules/hm-module.nix;
        "9router" = self.homeModules.default;
      };

      nixosModules = {
        default = ./nix/modules/nixos;
        "9router" = self.nixosModules.default;
      };

      # Checks - run by `nix flake check`.
      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          pkg = self.packages.${system}.default;
        in
        {
          # Smoke test: verify the built package's files exist. The package
          # layout is the published npm CLI layout (cli.js + app/ standalone).
          smoke =
            pkgs.runCommand "9router-smoke-test" { nativeBuildInputs = [ pkg ]; }
              ''
                test -x "${pkg}/bin/9router" || {
                  echo "ERROR: 9router binary not found or not executable"
                  exit 1
                }
                test -f "${pkg}/lib/9router/cli.js" || {
                  echo "ERROR: cli.js launcher not found in package output"
                  exit 1
                }
                test -f "${pkg}/lib/9router/app/custom-server.js" || {
                  echo "ERROR: custom-server.js not found in app bundle"
                  exit 1
                }
                test -f "${pkg}/lib/9router/app/server.js" || {
                  echo "ERROR: standalone server.js not found in app bundle"
                  exit 1
                }
                test -d "${pkg}/lib/9router/app/.next-cli-build" || {
                  echo "ERROR: .next-cli-build not found in app bundle"
                  exit 1
                }
                test -f "${pkg}/lib/9router/app/src/mitm/server.js" || {
                  echo "ERROR: bundled MITM server not found in app bundle"
                  exit 1
                }
                test -d "${pkg}/lib/9router/node_modules" || {
                  echo "ERROR: cli node_modules not found in package output"
                  exit 1
                }
                echo "All smoke checks passed"
                touch $out
              '';

          # Home-manager module structure test: the module file must exist,
          # define the expected option path, and be syntactically loadable.
          hmModuleStruct =
            pkgs.runCommand "9router-hm-module-struct-test" { }
              ''
                test -s ${./nix/modules/hm-module.nix} || {
                  echo "ERROR: hm-module.nix is missing or empty"
                  exit 1
                }
                grep -q 'programs\."9router"' ${./nix/modules/hm-module.nix} || {
                  echo "ERROR: hm-module.nix does not define programs.9router option"
                  exit 1
                }
                grep -q 'mkEnableOption' ${./nix/modules/hm-module.nix} || {
                  echo "ERROR: hm-module.nix missing mkEnableOption"
                  exit 1
                }
                echo "Home-manager module structure checks passed"
                touch $out
              '';

          # NixOS module structure test, same idea.
          nixosModuleStruct =
            pkgs.runCommand "9router-nixos-module-struct-test" { }
              ''
                test -s ${./nix/modules/nixos/default.nix} || {
                  echo "ERROR: nixos/default.nix is missing or empty"
                  exit 1
                }
                grep -q 'services\."9router"' ${./nix/modules/nixos/default.nix} || {
                  echo "ERROR: nixos module does not define services.9router option"
                  exit 1
                }
                grep -q 'systemd.services' ${./nix/modules/nixos/default.nix} || {
                  echo "ERROR: nixos module missing systemd service"
                  exit 1
                }
                echo "NixOS module structure checks passed"
                touch $out
              '';
        }
      );
    };
}
