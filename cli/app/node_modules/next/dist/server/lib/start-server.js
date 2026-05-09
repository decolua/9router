// Start CPU profile if it wasn't already started.
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getRequestHandlers: null,
    startServer: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getRequestHandlers: function() {
        return getRequestHandlers;
    },
    startServer: function() {
        return startServer;
    }
});
require("./cpu-profile");
const _getnetworkhost = require("../../lib/get-network-host");
require("../next");
require("../require-hook");
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _v8 = /*#__PURE__*/ _interop_require_default(require("v8"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _http = /*#__PURE__*/ _interop_require_default(require("http"));
const _https = /*#__PURE__*/ _interop_require_default(require("https"));
const _os = /*#__PURE__*/ _interop_require_default(require("os"));
const _child_process = require("child_process");
const _watchpack = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/watchpack"));
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../build/output/log"));
const _debug = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/debug"));
const _utils = require("./utils");
const _formathostname = require("./format-hostname");
const _routerserver = require("./router-server");
const _constants = require("../../shared/lib/constants");
const _appinfolog = require("./app-info-log");
const _turbopackwarning = require("../../lib/turbopack-warning");
const _trace = require("../../trace");
const _isipv6 = require("./is-ipv6");
const _asynccallbackset = require("./async-callback-set");
const _durationtostring = require("../../build/duration-to-string");
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
const debug = (0, _debug.default)('next:start-server');
let startServerSpan;
/**
 * Get the process ID (PID) of the process using the specified port
 */ async function getProcessIdUsingPort(port) {
    const timeoutMs = 250;
    const processLookupController = new AbortController();
    const pidPromise = new Promise((resolve)=>{
        const handleError = (error)=>{
            debug('Failed to get process ID for port', port, error);
            resolve(null);
        };
        try {
            // Use lsof on Unix-like systems (macOS, Linux)
            if (process.platform !== 'win32') {
                (0, _child_process.exec)(`lsof -ti:${port} -sTCP:LISTEN`, {
                    signal: processLookupController.signal
                }, (error, stdout)=>{
                    if (error) {
                        handleError(error);
                        return;
                    }
                    // `-sTCP` will ensure there's only one port, clean up output
                    const pid = stdout.trim();
                    resolve(pid || null);
                });
            } else {
                // Use netstat on Windows
                (0, _child_process.exec)(`netstat -ano | findstr /C:":${port} " | findstr LISTENING`, {
                    signal: processLookupController.signal
                }, (error, stdout)=>{
                    if (error) {
                        handleError(error);
                        return;
                    }
                    // Clean up output and extract PID
                    const cleanOutput = stdout.replace(/\s+/g, ' ').trim();
                    if (cleanOutput) {
                        const lines = cleanOutput.split('\n');
                        const firstLine = lines[0].trim();
                        if (firstLine) {
                            const parts = firstLine.split(' ');
                            const pid = parts[parts.length - 1];
                            resolve(pid || null);
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                });
            }
        } catch (cause) {
            handleError(Object.defineProperty(new Error('Unexpected error during process lookup', {
                cause
            }), "__NEXT_ERROR_CODE", {
                value: "E713",
                enumerable: false,
                configurable: true
            }));
        }
    });
    const timeoutId = setTimeout(()=>{
        processLookupController.abort(`PID detection timed out after ${timeoutMs}ms for port ${port}.`);
    }, timeoutMs);
    pidPromise.finally(()=>clearTimeout(timeoutId));
    return pidPromise;
}
async function getRequestHandlers({ dir, port, isDev, onDevServerCleanup, server, hostname, minimalMode, keepAliveTimeout, experimentalHttpsServer, serverFastRefresh, quiet }) {
    return (0, _routerserver.initialize)({
        dir,
        port,
        hostname,
        onDevServerCleanup,
        dev: isDev,
        minimalMode,
        server,
        keepAliveTimeout,
        experimentalHttpsServer,
        serverFastRefresh,
        startServerSpan,
        quiet
    });
}
async function startServer(serverOptions) {
    const { dir, isDev, hostname, minimalMode, allowRetry, keepAliveTimeout, selfSignedCertificate, serverFastRefresh } = serverOptions;
    let { port } = serverOptions;
    process.title = `next-server (v${"16.2.1"})`;
    let handlersReady = ()=>{};
    let handlersError = ()=>{};
    let handlersPromise = new Promise((resolve, reject)=>{
        handlersReady = resolve;
        handlersError = reject;
    });
    let requestHandler = async (req, res)=>{
        if (handlersPromise) {
            await handlersPromise;
            return requestHandler(req, res);
        }
        throw Object.defineProperty(new Error('Invariant request handler was not setup'), "__NEXT_ERROR_CODE", {
            value: "E287",
            enumerable: false,
            configurable: true
        });
    };
    let upgradeHandler = async (req, socket, head)=>{
        if (handlersPromise) {
            await handlersPromise;
            return upgradeHandler(req, socket, head);
        }
        throw Object.defineProperty(new Error('Invariant upgrade handler was not setup'), "__NEXT_ERROR_CODE", {
            value: "E290",
            enumerable: false,
            configurable: true
        });
    };
    let nextServer;
    // setup server listener as fast as possible
    if (selfSignedCertificate && !isDev) {
        throw Object.defineProperty(new Error('Using a self signed certificate is only supported with `next dev`.'), "__NEXT_ERROR_CODE", {
            value: "E128",
            enumerable: false,
            configurable: true
        });
    }
    async function requestListener(req, res) {
        try {
            if (handlersPromise) {
                await handlersPromise;
                handlersPromise = undefined;
            }
            await requestHandler(req, res);
        } catch (err) {
            res.statusCode = 500;
            res.end('Internal Server Error');
            _log.error(`Failed to handle request for ${req.url}`);
            console.error(err);
        } finally{
            if (isDev) {
                if (_v8.default.getHeapStatistics().used_heap_size > 0.8 * _v8.default.getHeapStatistics().heap_size_limit) {
                    _log.warn(`Server is approaching the used memory threshold, restarting...`);
                    (0, _trace.trace)('server-restart-close-to-memory-threshold', undefined, {
                        'memory.heapSizeLimit': String(_v8.default.getHeapStatistics().heap_size_limit),
                        'memory.heapUsed': String(_v8.default.getHeapStatistics().used_heap_size)
                    }).stop();
                    await (0, _trace.flushAllTraces)();
                    process.exit(_utils.RESTART_EXIT_CODE);
                }
            }
        }
    }
    const server = selfSignedCertificate ? _https.default.createServer({
        key: _fs.default.readFileSync(selfSignedCertificate.key),
        cert: _fs.default.readFileSync(selfSignedCertificate.cert)
    }, requestListener) : _http.default.createServer(requestListener);
    if (keepAliveTimeout) {
        server.keepAliveTimeout = keepAliveTimeout;
    }
    server.on('upgrade', async (req, socket, head)=>{
        try {
            await upgradeHandler(req, socket, head);
        } catch (err) {
            socket.destroy();
            _log.error(`Failed to handle request for ${req.url}`);
            console.error(err);
        }
    });
    let portRetryCount = 0;
    const originalPort = port;
    server.on('error', (err)=>{
        if (allowRetry && port && isDev && err.code === 'EADDRINUSE' && portRetryCount < 10) {
            port += 1;
            portRetryCount += 1;
            server.listen(port, hostname);
        } else {
            _log.error(`Failed to start server`);
            console.error(err);
            process.exit(1);
        }
    });
    let cleanupListeners = isDev ? new _asynccallbackset.AsyncCallbackSet() : undefined;
    const distDir = await new Promise((resolve)=>{
        server.on('listening', async ()=>{
            const addr = server.address();
            const actualHostname = (0, _formathostname.formatHostname)(typeof addr === 'object' ? (addr == null ? void 0 : addr.address) || hostname || 'localhost' : addr);
            const formattedHostname = !hostname || actualHostname === '0.0.0.0' ? 'localhost' : actualHostname === '[::]' ? '[::1]' : (0, _formathostname.formatHostname)(hostname);
            port = typeof addr === 'object' ? (addr == null ? void 0 : addr.port) || port : port;
            if (portRetryCount) {
                const pid = await getProcessIdUsingPort(originalPort);
                if (pid) {
                    _log.warn(`Port ${originalPort} is in use by process ${pid}, using available port ${port} instead.`);
                } else {
                    _log.warn(`Port ${originalPort} is in use by an unknown process, using available port ${port} instead.`);
                }
            }
            const networkHostname = hostname ?? (0, _getnetworkhost.getNetworkHost)((0, _isipv6.isIPv6)(actualHostname) ? 'IPv6' : 'IPv4');
            const protocol = selfSignedCertificate ? 'https' : 'http';
            const networkUrl = networkHostname ? `${protocol}://${(0, _formathostname.formatHostname)(networkHostname)}:${port}` : null;
            const appUrl = `${protocol}://${formattedHostname}:${port}`;
            // Store the selected port to:
            // - expose it to render workers
            // - re-use it for automatic dev server restarts with a randomly selected port
            process.env.PORT = port + '';
            process.env.__NEXT_PRIVATE_ORIGIN = appUrl;
            // Set experimental HTTPS flag for metadata resolution
            if (selfSignedCertificate) {
                process.env.__NEXT_EXPERIMENTAL_HTTPS = '1';
            }
            // Get env info first (fast, doesn't require config)
            const envInfo = isDev ? (0, _appinfolog.getEnvInfo)(dir) : undefined;
            // Log basic startup info immediately (before loading config)
            (0, _appinfolog.logStartInfo)({
                networkUrl,
                appUrl,
                envInfo,
                logBundler: isDev
            });
            // Calculate and log "Ready in X" before loading config
            // so it reflects actual framework startup time.
            // NEXT_PRIVATE_START_TIME is set by bin/next.ts or cli/next-start.ts.
            const startTime = parseInt(process.env.NEXT_PRIVATE_START_TIME || '0', 10);
            const endTime = Date.now();
            const startServerProcessDurationMs = startTime ? endTime - startTime : 0;
            const formattedStartDuration = (0, _durationtostring.durationToString)(startServerProcessDurationMs / 1000);
            _log.event(`Ready in ${formattedStartDuration}`);
            try {
                let cleanupStarted = false;
                let closeUpgraded = null;
                const cleanup = (signal)=>{
                    if (cleanupStarted) {
                        // We can get duplicate signals, e.g. when `ctrl+c` is used in an
                        // interactive shell (i.e. bash, zsh), the shell will recursively
                        // send SIGINT to children. The parent `next-dev` process will also
                        // send us SIGINT.
                        return;
                    }
                    cleanupStarted = true;
                    (async ()=>{
                        debug('start-server process cleanup');
                        // first, stop accepting new connections and finish pending requests,
                        // because they might affect `nextServer.close()` (e.g. by scheduling an `after`)
                        await new Promise((res)=>{
                            server.close((err)=>{
                                if (err) console.error(err);
                                res();
                            });
                            if (isDev) {
                                server.closeAllConnections();
                                closeUpgraded == null ? void 0 : closeUpgraded();
                            }
                        });
                        // now that no new requests can come in, clean up the rest
                        await Promise.all([
                            nextServer == null ? void 0 : nextServer.close().catch(console.error),
                            cleanupListeners == null ? void 0 : cleanupListeners.runAll().catch(console.error)
                        ]);
                        // Flush any remaining traces to the trace file on shutdown
                        await (0, _trace.flushAllTraces)();
                        // Flush telemetry if this is a dev server
                        if (isDev) {
                            try {
                                const { traceGlobals } = require('../../trace/shared');
                                const telemetry = traceGlobals.get('telemetry');
                                if (telemetry) {
                                    // Use flushDetached to avoid blocking process exit
                                    // Each process writes to a unique file (_events_${pid}.json)
                                    // to avoid race conditions with the parent process
                                    telemetry.flushDetached('dev', dir);
                                }
                            } catch (_) {
                            // Ignore telemetry errors during cleanup
                            }
                        }
                        debug('start-server process cleanup finished');
                        // Exit with signal-based exit code (128 + signal number) so that
                        // Node.js treats this as a signal termination, not a normal exit.
                        // This avoids waiting for the debugger to disconnect.
                        switch(signal){
                            case 'SIGINT':
                                process.exit(130);
                                break;
                            case 'SIGTERM':
                                process.exit(143);
                                break;
                            default:
                                // Make sure all handled signals have explicit exit codes.
                                // This is just a fallback to guard against unsound types.
                                signal;
                                process.exit(128);
                        }
                    })();
                };
                // Make sure commands gracefully respect termination signals (e.g. from Docker)
                // Allow the graceful termination to be manually configurable
                if (!process.env.NEXT_MANUAL_SIG_HANDLE) {
                    process.on('SIGINT', cleanup);
                    process.on('SIGTERM', cleanup);
                }
                // Now load config via getRequestHandlers (single loadConfig call)
                const initResult = await getRequestHandlers({
                    dir,
                    port,
                    isDev,
                    onDevServerCleanup: cleanupListeners ? cleanupListeners.add.bind(cleanupListeners) : undefined,
                    server,
                    hostname,
                    minimalMode,
                    keepAliveTimeout,
                    experimentalHttpsServer: !!selfSignedCertificate,
                    serverFastRefresh
                });
                requestHandler = initResult.requestHandler;
                upgradeHandler = initResult.upgradeHandler;
                nextServer = initResult.server;
                closeUpgraded = initResult.closeUpgraded;
                // Log experimental features after config is loaded
                if (isDev) {
                    (0, _appinfolog.logExperimentalInfo)({
                        experimentalFeatures: initResult.experimentalFeatures,
                        cacheComponents: initResult.cacheComponents
                    });
                }
                handlersReady();
                if (process.env.TURBOPACK && isDev) {
                    await (0, _turbopackwarning.validateTurboNextConfig)({
                        dir: serverOptions.dir,
                        configPhase: _constants.PHASE_DEVELOPMENT_SERVER
                    });
                }
                resolve(initResult.distDir);
            } catch (err) {
                // fatal error if we can't setup
                handlersError();
                console.error(err);
                process.exit(1);
            }
        });
        server.listen(port, hostname);
    });
    if (isDev) {
        function watchConfigFiles(dirToWatch, onChange) {
            const wp = new _watchpack.default();
            wp.watch({
                files: _constants.CONFIG_FILES.map((file)=>_path.default.join(dirToWatch, file))
            });
            wp.on('change', onChange);
        }
        watchConfigFiles(dir, async (filename)=>{
            if (process.env.__NEXT_DISABLE_MEMORY_WATCHER) {
                _log.info(`Detected change, manual restart required due to '__NEXT_DISABLE_MEMORY_WATCHER' usage`);
                return;
            }
            _log.warn(`Found a change in ${_path.default.basename(filename)}. Restarting the server to apply the changes...`);
            process.exit(_utils.RESTART_EXIT_CODE);
        });
    }
    return {
        distDir
    };
}
if (process.env.NEXT_PRIVATE_WORKER && process.send) {
    process.addListener('message', async (msg)=>{
        if (msg && typeof msg === 'object' && msg.nextWorkerOptions && process.send) {
            let enabledFeaturesFromParent = {};
            if (process.env.NEXT_PRIVATE_ENABLED_FEATURES) {
                const parsed = JSON.parse(process.env.NEXT_PRIVATE_ENABLED_FEATURES);
                enabledFeaturesFromParent = Object.fromEntries(Object.entries(parsed).map(([key, value])=>[
                        `feature.${key}`,
                        value
                    ]));
            }
            startServerSpan = (0, _trace.trace)('start-dev-server', undefined, {
                cpus: String(_os.default.cpus().length),
                platform: _os.default.platform(),
                'memory.freeMem': String(_os.default.freemem()),
                'memory.totalMem': String(_os.default.totalmem()),
                'memory.heapSizeLimit': String(_v8.default.getHeapStatistics().heap_size_limit),
                ...enabledFeaturesFromParent
            });
            (0, _trace.initializeTraceState)({
                ...(0, _trace.exportTraceState)(),
                defaultParentSpanId: startServerSpan.getId()
            });
            const result = await startServerSpan.traceAsyncFn(()=>startServer(msg.nextWorkerOptions));
            const memoryUsage = process.memoryUsage();
            startServerSpan.setAttribute('memory.rss', String(memoryUsage.rss));
            startServerSpan.setAttribute('memory.heapTotal', String(memoryUsage.heapTotal));
            startServerSpan.setAttribute('memory.heapUsed', String(memoryUsage.heapUsed));
            process.send({
                nextServerReady: true,
                port: process.env.PORT,
                distDir: result.distDir
            });
        }
    });
    process.send({
        nextWorkerReady: true
    });
}

//# sourceMappingURL=start-server.js.map