# NixOS module for 9Router - runs the dashboard/API gateway as a systemd
# service. The service execs the standalone server directly (the same
# custom-server.js the CLI spawns), skipping the launcher's update check,
# browser open, and tray logic that don't apply to a headless service.
#
# Usage:
#   inputs.9router.url = "github:decolua/9router";
#   nixpkgs.overlays = [ inputs.9router.overlays.default ];
#   imports = [ inputs.9router.nixosModules.default ];
#   services."9router".enable = true;
{ pkgs, lib, config, ... }:

with lib;

let
  cfg = config.services."9router";
in
{
  options.services."9router" = {
    enable = mkEnableOption "9Router - local AI routing gateway + dashboard";

    package = mkOption {
      type = types.package;
      default = pkgs."9router" or (throw ''
        9router package not found in pkgs.
        Add the 9router flake overlay:
          nixpkgs.overlays = [ inputs.9router.overlays.default ];
      '');
      description = "The 9router package to use.";
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

    user = mkOption {
      type = types.str;
      default = "9router";
      description = "User to run 9Router as.";
    };

    group = mkOption {
      type = types.str;
      default = "9router";
      description = "Group to run 9Router as.";
    };

    dataDir = mkOption {
      type = types.path;
      default = "/var/lib/9router";
      description = "Data directory for 9Router (SQLite database, usage logs, runtime deps).";
    };

    environmentFile = mkOption {
      type = with types; nullOr path;
      default = null;
      description = ''
        Path to an environment file loaded by the systemd service via
        EnvironmentFile=. Use it for secrets and deployment config -
        9router reads INITIAL_PASSWORD, JWT_SECRET, API_KEY_SECRET,
        MACHINE_ID_SALT, and other env vars at startup
        (see .env.example upstream).
      '';
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Whether to open the firewall for the 9Router port.";
    };
  };

  config = mkIf cfg.enable {
    users.users.${cfg.user} = {
      isSystemUser = true;
      inherit (cfg) group;
      home = cfg.dataDir;
      createHome = true;
    };
    users.groups.${cfg.group} = { };

    networking.firewall.allowedTCPPorts = mkIf cfg.openFirewall [ cfg.port ];

    systemd.services."9router" = {
      description = "9Router AI routing gateway + dashboard";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        NODE_ENV = "production";
        NEXT_TELEMETRY_DISABLED = "1";
        PORT = toString cfg.port;
        HOSTNAME = cfg.hostname;
        DATA_DIR = cfg.dataDir;
      };

      serviceConfig = {
        # Exec the standalone server directly - the same entry point the CLI
        # spawns (custom-server.js wraps the Next standalone server to derive
        # the real client IP from the TCP socket).
        ExecStart = "${pkgs.nodejs_22}/bin/node ${cfg.package}/lib/9router/app/custom-server.js";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.dataDir;
        StateDirectory = mkIf (cfg.dataDir == "/var/lib/9router") "9router";
        Restart = "on-failure";
        RestartSec = "5s";
        # Security hardening. The store path is read-only; all state writes
        # go to dataDir.
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];
      } // (optionalAttrs (cfg.environmentFile != null) {
        EnvironmentFile = cfg.environmentFile;
      });
    };
  };
}
