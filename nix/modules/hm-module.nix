# Home-Manager module for 9Router.
#
# Usage in home-manager config:
#   imports = [ github:decolua/9router/nix/modules/hm-module.nix ];
#   programs."9router".enable = true;
#   programs."9router".port = 20128;
#   programs."9router".dataDir = "~/.9router";
{ pkgs, lib, config, ... }:

with lib;

let
  cfg = config.programs."9router";
in
{
  options.programs."9router" = {
    enable = mkEnableOption "9Router — local AI routing gateway + dashboard";

    package = mkOption {
      type = types.package;
      default = pkgs."9router" or (throw ''
        9router package not found in pkgs.
        Add the 9router flake as an overlay or import it directly:
          overlays.default = final: prev: {
            "9router" = self.packages.''${final.system}.default;
          };
      '');
      description = ''
        The 9router package to use. By default, this looks for
        <literal>pkgs."9router"</literal>, which is available when the
        9router flake overlay is applied. Alternatively, set this to
        <literal>inputs.9router.packages.''${system}.default</literal>
        in your home-manager config.
      '';
    };

    port = mkOption {
      type = types.port;
      default = 20128;
      description = "Port for the 9Router dashboard and API server.";
    };

    hostname = mkOption {
      type = types.str;
      default = "0.0.0.0";
      description = "Hostname to bind the 9Router server to.";
    };

    dataDir = mkOption {
      type = types.str;
      default = "~/.9router";
      description = ''
        Directory for 9Router data (SQLite database, usage logs, etc.).
        Defaults to <literal>~/.9router</literal>.
      '';
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Whether to open the firewall for the 9Router port.
        Only applies on NixOS (ignored on Darwin/standalone home-manager).
      '';
    };
  };

  config = mkIf cfg.enable {
    home.packages = [ cfg.package ];

    # Set environment variables so the 9router binary picks up the
    # configured port/hostname/dataDir without manual env setup.
    home.sessionVariables = mkIf pkgs.stdenv.hostPlatform.isLinux {
      PORT = toString cfg.port;
      HOSTNAME = cfg.hostname;
      DATA_DIR = cfg.dataDir;
    };

    # On macOS, home.sessionVariables doesn't reliably set env vars for
    # GUI-launched apps. Write a small wrapper that sets the env vars
    # and delegates to the real binary.
    home.file."bin/9router-configured" = {
      executable = true;
      text = ''
        #!/bin/sh
        export PORT="${toString cfg.port}"
        export HOSTNAME="${cfg.hostname}"
        export DATA_DIR="${cfg.dataDir}"
        exec "${cfg.package}/bin/9router" "$@"
      '';
    };
  };
}
