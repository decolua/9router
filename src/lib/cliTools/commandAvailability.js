import { execFile } from "node:child_process";

// CLI status is refreshed from several dashboard views.  Keep a short cache so
// those refreshes do not repeatedly create a process just to search PATH.
export const COMMAND_LOOKUP_TIMEOUT_MS = 2_500;
export const COMMAND_LOOKUP_CACHE_TTL_MS = 10_000;
export const COMMAND_OUTPUT_CACHE_TTL_MS = 10_000;

const SAFE_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

function runExecFile(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function pathEnvironment(env, platform) {
  if (platform !== "win32") return env;

  const appData = env.APPDATA;
  if (!appData) return env;

  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
  const separator = ";";
  const npmBin = `${appData.replace(/[\\/]+$/, "")}\\npm`;
  const currentPath = env[pathKey] || "";
  const alreadyPresent = currentPath
    .split(separator)
    .some((entry) => entry.trim().toLowerCase() === npmBin.toLowerCase());

  if (alreadyPresent) return env;
  return {
    ...env,
    [pathKey]: currentPath ? `${npmBin}${separator}${currentPath}` : npmBin,
  };
}

function firstPath(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || null;
}

function validCommandName(command) {
  return typeof command === "string" && SAFE_COMMAND_NAME.test(command);
}

/**
 * Creates a bounded, shell-free command probe.  Exported primarily so the
 * concurrency and timeout guarantees can be regression-tested without spawning
 * a real process.
 */
export function createCommandAvailabilityProbe({
  execFileImpl = execFile,
  platform = process.platform,
  env = process.env,
  now = () => Date.now(),
} = {}) {
  const lookupCache = new Map();
  const lookupInFlight = new Map();
  const outputCache = new Map();
  const outputInFlight = new Map();

  const lookupCommand = async (command) => {
    if (!validCommandName(command)) return null;

    const cached = lookupCache.get(command);
    if (cached && cached.expiresAt > now()) return cached.value;

    if (lookupInFlight.has(command)) return lookupInFlight.get(command);

    const executable = platform === "win32" ? "where.exe" : "which";
    const promise = runExecFile(execFileImpl, executable, [command], {
      windowsHide: true,
      timeout: COMMAND_LOOKUP_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      env: pathEnvironment(env, platform),
    })
      .then(({ stdout }) => firstPath(stdout))
      .catch(() => null)
      .then((value) => {
        lookupCache.set(command, {
          value,
          expiresAt: now() + COMMAND_LOOKUP_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        lookupInFlight.delete(command);
      });

    lookupInFlight.set(command, promise);
    return promise;
  };

  const getCommandOutput = async (command, args = []) => {
    if (!validCommandName(command) || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      return null;
    }

    const cacheKey = `${command}\u0000${args.join("\u0000")}`;
    const cached = outputCache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return cached.value;

    if (outputInFlight.has(cacheKey)) return outputInFlight.get(cacheKey);

    const promise = lookupCommand(command)
      .then(async (commandPath) => {
        // execFile cannot launch batch files without cmd.exe.  Treat the
        // optional version as unavailable rather than reintroducing a shell.
        if (!commandPath || (platform === "win32" && /\.(?:cmd|bat)$/i.test(commandPath))) return null;
        const { stdout, stderr } = await runExecFile(execFileImpl, commandPath, args, {
          windowsHide: true,
          timeout: COMMAND_LOOKUP_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
          env: pathEnvironment(env, platform),
        });
        return `${stdout} ${stderr}`.trim() || null;
      })
      .catch(() => null)
      .then((value) => {
        outputCache.set(cacheKey, {
          value,
          expiresAt: now() + COMMAND_OUTPUT_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        outputInFlight.delete(cacheKey);
      });

    outputInFlight.set(cacheKey, promise);
    return promise;
  };

  return {
    findCommandOnPath: lookupCommand,
    isCommandAvailable: async (command) => Boolean(await lookupCommand(command)),
    getCommandOutput,
    clearCache() {
      lookupCache.clear();
      lookupInFlight.clear();
      outputCache.clear();
      outputInFlight.clear();
    },
  };
}

const sharedProbe = createCommandAvailabilityProbe();

export const findCommandOnPath = sharedProbe.findCommandOnPath;
export const isCommandAvailable = sharedProbe.isCommandAvailable;
export const getCommandOutput = sharedProbe.getCommandOutput;

