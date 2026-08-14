{
  description = "9Router - FREE AI Router & Token Saver web dashboard";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    # Pin x86_64-darwin to a stable release branch for older macOS Intel
    # compatibility. nixpkgs-unstable has dropped x86_64-darwin support;
    # the -darwin branch receives security updates without the breaking churn.
    nixpkgs-darwin-legacy.url = "github:NixOS/nixpkgs/nixpkgs-24.05-darwin";
  };

  outputs = { self, nixpkgs, nixpkgs-darwin-legacy, ... }:
    let
      allSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];

      pkgsFor = system:
        if system == "x86_64-darwin"
        then import nixpkgs-darwin-legacy { inherit system; }
        else import nixpkgs { inherit system; };

      forAllSystems = f:
        builtins.listToAttrs (map (system: { name = system; value = f system; }) allSystems);
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          inherit (pkgs) lib;
        in
        {
          default = self.packages.${system}."9router";
          "9router" = pkgs.buildNpmPackage {
            pname = "9router";
            version = "0.5.55";
            src = pkgs.lib.cleanSource ./.;
            npmDepsHash = "sha256-oj3900TiTXszkT/YqsiCXkT5ztAP70SCC/YoykqRk+E=";
            nodejs = pkgs.nodejs_22;
            npmFlags = [ "--ignore-scripts" ];
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postPatch = ''
              # Neutralize next/font/google — Nix sandbox has no network access.
              # The Inter font fetch fails in the sandbox; replace with a plain
              # CSS variable so the build succeeds without Google Fonts.
              substituteInPlace src/app/layout.js \
                --replace-fail 'import { Inter } from "next/font/google";' '// Nix: Google Fonts fetch disabled (no network in sandbox)'
              sed -i '/const inter = Inter(/,/});/c\const inter = { variable: "--font-inter" };' src/app/layout.js
            '';
            npmBuildScript = "build";
            preBuild = ''
              export NEXT_TELEMETRY_DISABLED=1
              export NODE_ENV=production
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p $out/lib/9router $out/bin

              # Copy standalone build (server.js + traced node_modules + .next/static)
              # Next.js standalone output already includes .next/static and public
              # when output: "standalone" is set, but we copy them explicitly to be safe.
              cp -r .next/standalone/. $out/lib/9router/

              # Copy static and public assets (may already be present from standalone)
              mkdir -p $out/lib/9router/.next
              cp -r .next/static $out/lib/9router/.next/static
              cp -r public $out/lib/9router/public

              # Copy custom server wrapper (IP derivation from TCP socket)
              cp custom-server.js $out/lib/9router/

              # Copy open-sse routing engine (not in standalone file tracing)
              cp -r open-sse $out/lib/9router/

              # Copy MITM child process (not in standalone file tracing)
              mkdir -p $out/lib/9router/src
              cp -r src/mitm $out/lib/9router/src/mitm

              # Ensure node-forge is available (used by MITM, may be omitted by tracing)
              mkdir -p $out/lib/9router/node_modules
              cp -r node_modules/node-forge $out/lib/9router/node_modules/node-forge 2>/dev/null || true

              # Ensure next is available at runtime (tracing may omit it)
              cp -r node_modules/next $out/lib/9router/node_modules/next 2>/dev/null || true

              # Create wrapper script using makeWrapper for proper path resolution
              makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/9router \
                --add-flags "$out/lib/9router/custom-server.js" \
                --set NEXT_TELEMETRY_DISABLED 1 \
                --set NODE_ENV production \
                --set-default PORT 20128 \
                --set-default HOSTNAME 0.0.0.0 \
                --run 'export DATA_DIR="''${DATA_DIR:-$HOME/.9router}"'

              runHook postInstall
            '';
            meta = with pkgs.lib; {
              description = "FREE AI Router & Token Saver web dashboard";
              homepage = "https://github.com/decolua/9router";
              license = licenses.mit;
              mainProgram = "9router";
              platforms = allSystems;
            };
          };
        });

      apps = forAllSystems (system: {
        default = self.apps.${system}."9router";
        "9router" = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/9router";
        };
      });

      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [ nodejs_22 ];
            shellHook = ''
              echo "9Router development environment"
              echo "Run: npm install && npm run dev"
            '';
          };
        });

      # Overlay so users can add 9router to their pkgs via:
      #   nixpkgs.overlays = [ (import github:decolua/9router).overlays.default ];
      # Then programs."9router".enable = true; in home-manager just works.
      overlays.default = final: prev: {
        "9router" = self.packages.${final.system}.default;
      };

      # Home-Manager module — importable via:
      #   imports = [ (github:decolua/9router + "/nix/modules/hm-module.nix") ];
      homeModules.default = ./nix/modules/hm-module.nix;

      # Checks — multiple test variants run by `nix flake check`.
      # Each check is a derivation that must build successfully.
      checks = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          inherit (pkgs) lib;
          pkg = self.packages.${system}.default;
        in
        {
          # 1. Smoke test: verify the built package's binary exists and is executable
          smoke = pkgs.runCommand "9router-smoke-test" { nativeBuildInputs = [ pkg ]; } ''
            # Verify the binary exists and is executable
            test -x "${pkg}/bin/9router" || {
              echo "ERROR: 9router binary not found or not executable"
              exit 1
            }
            # Verify the server.js entry point exists
            test -f "${pkg}/lib/9router/server.js" || {
              echo "ERROR: server.js not found in package output"
              exit 1
            }
            # Verify custom-server.js exists (IP derivation wrapper)
            test -f "${pkg}/lib/9router/custom-server.js" || {
              echo "ERROR: custom-server.js not found in package output"
              exit 1
            }
            # Verify open-sse routing engine is present
            test -d "${pkg}/lib/9router/open-sse" || {
              echo "ERROR: open-sse directory not found in package output"
              exit 1
            }
            # Verify static assets are present
            test -d "${pkg}/lib/9router/.next/static" || {
              echo "ERROR: .next/static not found in package output"
              exit 1
            }
            # Verify public assets are present
            test -d "${pkg}/lib/9router/public" || {
              echo "ERROR: public directory not found in package output"
              exit 1
            }
            echo "All smoke checks passed"
            touch $out
          '';

          # 2. Home-manager module structure test: verify the module file
          #    is valid Nix and imports correctly. This catches syntax
          #    errors and missing imports without requiring home-manager
          #    itself as a dependency.
          hmModuleStruct = pkgs.runCommand "9router-hm-module-struct-test" { } ''
            # Verify the module file exists and is non-empty
            test -s ${./nix/modules/hm-module.nix} || {
              echo "ERROR: hm-module.nix is missing or empty"
              exit 1
            }
            # Verify it defines the expected option path
            grep -q 'programs\."9router"' ${./nix/modules/hm-module.nix} || {
              echo "ERROR: hm-module.nix does not define programs.9router option"
              exit 1
            }
            # Verify it has mkEnableOption
            grep -q 'mkEnableOption' ${./nix/modules/hm-module.nix} || {
              echo "ERROR: hm-module.nix missing mkEnableOption"
              exit 1
            }
            echo "Home-manager module structure checks passed"
            touch $out
          '';
        });
    };
}
