"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    Lockfile: null,
    parseDevServerInfo: null,
    readLockfileContent: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    Lockfile: function() {
        return Lockfile;
    },
    parseDevServerInfo: function() {
        return parseDevServerInfo;
    },
    readLockfileContent: function() {
        return readLockfileContent;
    }
});
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _picocolors = require("../lib/picocolors");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("./output/log"));
const _swc = require("./swc");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const RETRY_DELAY_MS = 10;
const MAX_RETRY_MS = 1000;
function readLockfileContent(lockfilePath) {
    try {
        return _fs.default.readFileSync(lockfilePath, 'utf-8');
    } catch  {
        return undefined;
    }
}
function parseDevServerInfo(content) {
    try {
        return JSON.parse(content);
    } catch  {
        return undefined;
    }
}
class Lockfile {
    constructor(bindings, nativeLockfile){
        this.bindings = bindings;
        this.nativeLockfile = nativeLockfile;
    }
    /**
   * Attempts to create or acquire an exclusive lockfile on disk. Lockfiles are
   * best-effort, depending on the platform.
   *
   * - If we fail to acquire the lock, we return `undefined`.
   * - If we're on wasm, this always returns a dummy `Lockfile` object.
   *
   * @param path - Path to the lock file
   * @param unlockOnExit - Whether to unlock the file on process exit
   * @param content - Optional content to write to the lockfile (e.g., JSON with server info)
   */ static tryAcquire(path, unlockOnExit = true, content) {
        const bindings = (0, _swc.getBindingsSync)();
        if (bindings.isWasm) {
            _log.info(`Skipping creating a lockfile at ${(0, _picocolors.cyan)(path)} because we're using WASM bindings`);
            return new Lockfile(bindings, undefined);
        } else {
            let nativeLockfile;
            try {
                nativeLockfile = bindings.lockfileTryAcquireSync(path, content);
            } catch (e) {
                // this happens if there's an IO error (e.g. `ENOENT`), which is
                // different than if we just didn't acquire the lock
                throw Object.defineProperty(new Error('An IO error occurred while attempting to create and acquire the lockfile', {
                    cause: e
                }), "__NEXT_ERROR_CODE", {
                    value: "E859",
                    enumerable: false,
                    configurable: true
                });
            }
            if (nativeLockfile != null) {
                const jsLockfile = new Lockfile(bindings, nativeLockfile);
                if (unlockOnExit) {
                    const exitListener = ()=>{
                        // Best-Effort: If we don't do this, the operating system will
                        // release the lock for us. This gives an opportunity to delete the
                        // unlocked lockfile (which is not otherwise deleted on POSIX).
                        //
                        // This must be synchronous because `process.on('exit', ...)` is
                        // synchronous.
                        jsLockfile.unlockSync();
                    };
                    process.on('exit', exitListener);
                    jsLockfile.listener = exitListener;
                }
                return jsLockfile;
            } else {
                return undefined;
            }
        }
    }
    /**
   * Attempts to create or acquire a lockfile using `Lockfile.tryAcquire`. If
   * that returns `undefined`, indicating that another process or caller has the
   * lockfile, then this will output an error message and exit the process with
   * a non-zero exit code.
   *
   * This will retry a small number of times. This can be useful when running
   * processes in a loop, e.g. if cleanup isn't fully synchronous due to child
   * parent/processes.
   *
   * @param path - Path to the lock file
   * @param processName - Name of the process for error messages (e.g., 'next dev')
   * @param unlockOnExit - Whether to unlock the file on process exit
   * @param content - Optional content to write to the lockfile (e.g., JSON with server info)
   * @param projectDir - Optional project directory for enhanced error messages
   * @param relativeDistDir - Optional relative dist directory path (e.g., '.next/dev')
   */ static async acquireWithRetriesOrExit(path, processName, unlockOnExit = true, content, projectDir, relativeDistDir) {
        const startMs = Date.now();
        let lockfile;
        while(Date.now() - startMs < MAX_RETRY_MS){
            lockfile = Lockfile.tryAcquire(path, unlockOnExit, content);
            if (lockfile !== undefined) break;
            await new Promise((resolve)=>setTimeout(resolve, RETRY_DELAY_MS));
        }
        if (lockfile === undefined) {
            const isDev = processName === 'next dev';
            if (isDev) {
                // For dev server, try to read server info from the lockfile itself
                const lockfileContent = readLockfileContent(path);
                const serverInfo = lockfileContent ? parseDevServerInfo(lockfileContent) : undefined;
                if (serverInfo) {
                    _log.error(`Another ${(0, _picocolors.cyan)(processName)} server is already running.`);
                    console.error();
                    console.error(`- Local:        ${(0, _picocolors.cyan)(serverInfo.appUrl)}`);
                    console.error(`- PID:          ${serverInfo.pid}`);
                    if (projectDir) {
                        console.error(`- Dir:          ${projectDir}`);
                    }
                    if (relativeDistDir) {
                        console.error(`- Log:          ${_path.default.join(relativeDistDir, 'logs', 'next-development.log')}`);
                    }
                    console.error();
                    // Use platform-appropriate kill command
                    const killCommand = process.platform === 'win32' ? `taskkill /PID ${serverInfo.pid} /F` : `kill ${serverInfo.pid}`;
                    console.error(`Run ${(0, _picocolors.cyan)(killCommand)} to stop it.`);
                } else {
                    // Fallback when we can't read server info from the lockfile
                    _log.error(`Another ${(0, _picocolors.cyan)(processName)} server is already running in this directory.`);
                    console.error(`Stop the other server before starting a new one.`);
                }
            } else {
                // For build, show that a build is in progress
                _log.error(`Another ${(0, _picocolors.cyan)(processName)} process is already running.`);
                console.error();
                console.error(`  This could be:`);
                console.error(`  - A ${(0, _picocolors.cyan)('next build')} still in progress`);
                console.error(`  - A previous build that didn't exit cleanly`);
                console.error();
                _log.info(`${(0, _picocolors.bold)('Suggestion:')} Wait for the build to complete.`);
            }
            process.exit(1);
        }
        return lockfile;
    }
    /**
   * Releases the lockfile and closes the file descriptor.
   *
   * If this is not called, the lock will be released by the operating system
   * when the file handle is closed during process exit.
   */ async unlock() {
        const { nativeLockfile, listener } = this;
        if (nativeLockfile !== undefined) {
            await this.bindings.lockfileUnlock(nativeLockfile);
        }
        if (listener !== undefined) {
            process.off('exit', listener);
        }
    }
    /**
   * A blocking version of `unlock`.
   */ unlockSync() {
        const { nativeLockfile, listener } = this;
        if (nativeLockfile !== undefined) {
            this.bindings.lockfileUnlockSync(nativeLockfile);
        }
        if (listener !== undefined) {
            process.off('exit', listener);
        }
    }
}

//# sourceMappingURL=lockfile.js.map