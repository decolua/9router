"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    HmrTarget: null,
    createDefineEnv: null,
    getBinaryMetadata: null,
    getBindingsSync: null,
    getModuleNamedExports: null,
    getSupportedArchTriples: null,
    initCustomTraceSubscriber: null,
    isReactCompilerRequired: null,
    loadBindings: null,
    lockfilePatchPromise: null,
    minify: null,
    parse: null,
    teardownTraceSubscriber: null,
    transform: null,
    transformSync: null,
    warnForEdgeRuntime: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    HmrTarget: function() {
        return HmrTarget;
    },
    createDefineEnv: function() {
        return createDefineEnv;
    },
    getBinaryMetadata: function() {
        return getBinaryMetadata;
    },
    getBindingsSync: function() {
        return getBindingsSync;
    },
    getModuleNamedExports: function() {
        return getModuleNamedExports;
    },
    getSupportedArchTriples: function() {
        return getSupportedArchTriples;
    },
    initCustomTraceSubscriber: function() {
        return initCustomTraceSubscriber;
    },
    isReactCompilerRequired: function() {
        return isReactCompilerRequired;
    },
    loadBindings: function() {
        return loadBindings;
    },
    lockfilePatchPromise: function() {
        return lockfilePatchPromise;
    },
    minify: function() {
        return minify;
    },
    parse: function() {
        return parse;
    },
    teardownTraceSubscriber: function() {
        return teardownTraceSubscriber;
    },
    transform: function() {
        return transform;
    },
    transformSync: function() {
        return transformSync;
    },
    warnForEdgeRuntime: function() {
        return warnForEdgeRuntime;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _url = require("url");
const _os = require("os");
const _triples = require("next/dist/compiled/@napi-rs/triples");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../output/log"));
const _defineenv = require("../define-env");
const _loaderWorkerPool = require("./loaderWorkerPool");
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
var HmrTarget = /*#__PURE__*/ function(HmrTarget) {
    HmrTarget["Client"] = "client";
    HmrTarget["Server"] = "server";
    return HmrTarget;
}({});
const nextVersion = "16.2.1";
const ArchName = (0, _os.arch)();
const PlatformName = (0, _os.platform)();
function infoLog(...args) {
    if (process.env.NEXT_PRIVATE_BUILD_WORKER) {
        return;
    }
    if (process.env.DEBUG) {
        _log.info(...args);
    }
}
function getSupportedArchTriples() {
    const { darwin, win32, linux, freebsd, android } = _triples.platformArchTriples;
    return {
        darwin,
        win32: {
            arm64: win32.arm64,
            ia32: win32.ia32.filter((triple)=>triple.abi === 'msvc'),
            x64: win32.x64.filter((triple)=>triple.abi === 'msvc')
        },
        linux: {
            // linux[x64] includes `gnux32` abi, with x64 arch.
            x64: linux.x64.filter((triple)=>triple.abi !== 'gnux32'),
            arm64: linux.arm64,
            // This target is being deprecated, however we keep it in `knownDefaultWasmFallbackTriples` for now
            arm: linux.arm
        },
        // Below targets are being deprecated, however we keep it in `knownDefaultWasmFallbackTriples` for now
        freebsd: {
            x64: freebsd.x64
        },
        android: {
            arm64: android.arm64,
            arm: android.arm
        }
    };
}
const triples = (()=>{
    var _supportedArchTriples_PlatformName, _platformArchTriples_PlatformName;
    const supportedArchTriples = getSupportedArchTriples();
    const targetTriple = (_supportedArchTriples_PlatformName = supportedArchTriples[PlatformName]) == null ? void 0 : _supportedArchTriples_PlatformName[ArchName];
    // If we have supported triple, return it right away
    if (targetTriple) {
        return targetTriple;
    }
    // If there isn't corresponding target triple in `supportedArchTriples`, check if it's excluded from original raw triples
    // Otherwise, it is completely unsupported platforms.
    let rawTargetTriple = (_platformArchTriples_PlatformName = _triples.platformArchTriples[PlatformName]) == null ? void 0 : _platformArchTriples_PlatformName[ArchName];
    if (rawTargetTriple) {
        _log.warn(`next-swc does not have native bindings support for target triple ${rawTargetTriple}. Native features like Turbopack will not be available.`);
    } else {
        _log.warn(`next-swc does not have native bindings for platform ${PlatformName}/${ArchName}. Native features like Turbopack will not be available.`);
    }
    return [];
})();
// Allow to specify an absolute path to the custom turbopack binary to load.
// If one of env variables is set, `loadNative` will try to use specified
// binary instead. This is thin, naive interface
// - `loadBindings` will not validate neither path nor the binary.
//
// Note these are internal flag: there's no stability, feature guarantee.
const __INTERNAL_CUSTOM_TURBOPACK_BINDINGS = process.env.__INTERNAL_CUSTOM_TURBOPACK_BINDINGS;
function checkVersionMismatch(pkgData) {
    const version = pkgData.version;
    if (version && version !== nextVersion) {
        _log.warn(`Mismatching @next/swc version, detected: ${version} while Next.js is on ${nextVersion}. Please ensure these match`);
    }
}
// These are the platforms we'll try to load wasm bindings first,
// only try to load native bindings if loading wasm binding somehow fails.
// Fallback to native binding is for migration period only,
// once we can verify loading-wasm-first won't cause visible regressions,
// we'll not include native bindings for these platform at all.
const knownDefaultWasmFallbackTriples = [
    'x86_64-unknown-freebsd',
    'aarch64-linux-android',
    'arm-linux-androideabi',
    'armv7-unknown-linux-gnueabihf',
    'i686-pc-windows-msvc'
];
// The last attempt's error code returned when cjs require to native bindings fails.
// If node.js throws an error without error code, this should be `unknown` instead of undefined.
// For the wasm-first targets (`knownDefaultWasmFallbackTriples`) this will be `unsupported_target`.
let lastNativeBindingsLoadErrorCode = undefined;
// Used to cache racing calls to `loadBindings`
let pendingBindings;
// The cached loaded bindings
let loadedBindings = undefined;
let downloadWasmPromise;
let swcTraceFlushGuard;
let downloadNativeBindingsPromise = undefined;
const lockfilePatchPromise = {};
function getBindingsSync() {
    if (!loadedBindings) {
        if (pendingBindings) {
            throw Object.defineProperty(new Error('Bindings not loaded yet, but they are being loaded, did you forget to await?'), "__NEXT_ERROR_CODE", {
                value: "E906",
                enumerable: false,
                configurable: true
            });
        }
        throw Object.defineProperty(new Error('bindings not loaded yet.  Either call `loadBindings` to wait for them to be available or ensure that `installBindings` has already been called.'), "__NEXT_ERROR_CODE", {
            value: "E907",
            enumerable: false,
            configurable: true
        });
    }
    return loadedBindings;
}
async function loadBindings(useWasmBinary = false) {
    if (loadedBindings) {
        return loadedBindings;
    }
    if (pendingBindings) {
        return pendingBindings;
    }
    // Increase Rust stack size as some npm packages being compiled need more than the default.
    if (!process.env.RUST_MIN_STACK) {
        process.env.RUST_MIN_STACK = '8388608';
    }
    if (process.env.NEXT_TEST_WASM) {
        useWasmBinary = true;
    }
    // rust needs stdout to be blocking, otherwise it will throw an error (on macOS at least) when writing a lot of data (logs) to it
    // see https://github.com/napi-rs/napi-rs/issues/1630
    // and https://github.com/nodejs/node/blob/main/doc/api/process.md#a-note-on-process-io
    if (process.stdout._handle != null) {
        // @ts-ignore
        process.stdout._handle.setBlocking == null ? void 0 : process.stdout._handle.setBlocking.call(process.stdout._handle, true);
    }
    if (process.stderr._handle != null) {
        // @ts-ignore
        process.stderr._handle.setBlocking == null ? void 0 : process.stderr._handle.setBlocking.call(process.stderr._handle, true);
    }
    pendingBindings = new Promise(async (resolve, reject)=>{
        if (!lockfilePatchPromise.cur) {
            // always run lockfile check once so that it gets patched
            // even if it doesn't fail to load locally
            lockfilePatchPromise.cur = require('../../lib/patch-incorrect-lockfile').patchIncorrectLockfile(process.cwd()).catch(console.error);
        }
        let attempts = [];
        const disableWasmFallback = process.env.NEXT_DISABLE_SWC_WASM;
        const unsupportedPlatform = triples.some((triple)=>!!(triple == null ? void 0 : triple.raw) && knownDefaultWasmFallbackTriples.includes(triple.raw));
        const isWebContainer = process.versions.webcontainer;
        // Normal execution relies on the param `useWasmBinary` flag to load, but
        // in certain cases where there isn't a native binary we always load wasm fallback first.
        const shouldLoadWasmFallbackFirst = !disableWasmFallback && useWasmBinary || unsupportedPlatform || isWebContainer;
        if (!unsupportedPlatform && useWasmBinary) {
            _log.warn(`experimental.useWasmBinary is not an option for supported platform ${PlatformName}/${ArchName} and will be ignored.`);
        }
        if (shouldLoadWasmFallbackFirst) {
            lastNativeBindingsLoadErrorCode = 'unsupported_target';
            const fallbackBindings = await tryLoadWasmWithFallback(attempts);
            if (fallbackBindings) {
                return resolve(fallbackBindings);
            }
        }
        // Trickle down loading `fallback` bindings:
        //
        // - First, try to load native bindings installed in node_modules.
        // - If that fails with `ERR_MODULE_NOT_FOUND`, treat it as case of https://github.com/npm/cli/issues/4828
        // that host system where generated package lock is not matching to the guest system running on, try to manually
        // download corresponding target triple and load it. This won't be triggered if native bindings are failed to load
        // with other reasons than `ERR_MODULE_NOT_FOUND`.
        // - Lastly, falls back to wasm binding where possible.
        try {
            return resolve(loadNative());
        } catch (a) {
            if (Array.isArray(a) && a.every((m)=>m.includes('it was not installed'))) {
                let fallbackBindings = await tryLoadNativeWithFallback(attempts);
                if (fallbackBindings) {
                    return resolve(fallbackBindings);
                }
            }
            attempts = attempts.concat(a);
        }
        // For these platforms we already tried to load wasm and failed, skip reattempt
        if (!shouldLoadWasmFallbackFirst && !disableWasmFallback) {
            const fallbackBindings = await tryLoadWasmWithFallback(attempts);
            if (fallbackBindings) {
                return resolve(fallbackBindings);
            }
        }
        await logLoadFailure(attempts, true);
        // Reject the promise to propagate the error (process.exit was removed to allow telemetry flush)
        reject(Object.defineProperty(new Error(`Failed to load SWC binary for ${PlatformName}/${ArchName}, see more info here: https://nextjs.org/docs/messages/failed-loading-swc`), "__NEXT_ERROR_CODE", {
            value: "E909",
            enumerable: false,
            configurable: true
        }));
    });
    loadedBindings = await pendingBindings;
    pendingBindings = undefined;
    return loadedBindings;
}
async function tryLoadNativeWithFallback(attempts) {
    const nativeBindingsDirectory = _path.default.join(_path.default.dirname(require.resolve('next/package.json')), 'next-swc-fallback');
    if (!downloadNativeBindingsPromise) {
        downloadNativeBindingsPromise = require('../../lib/download-swc').downloadNativeNextSwc(nextVersion, nativeBindingsDirectory, triples.map((triple)=>triple.platformArchABI));
    }
    await downloadNativeBindingsPromise;
    try {
        return loadNative(nativeBindingsDirectory);
    } catch (a) {
        attempts.push(...[].concat(a));
    }
    return undefined;
}
// helper for loadBindings
async function tryLoadWasmWithFallback(attempts) {
    try {
        let bindings = await loadWasm('');
        require('../../telemetry/events/swc-load-failure').eventSwcLoadFailure({
            wasm: 'enabled',
            nativeBindingsErrorCode: lastNativeBindingsLoadErrorCode
        });
        return bindings;
    } catch (a) {
        attempts.push(...[].concat(a));
    }
    try {
        // if not installed already download wasm package on-demand
        // we download to a custom directory instead of to node_modules
        // as node_module import attempts are cached and can't be re-attempted
        // x-ref: https://github.com/nodejs/modules/issues/307
        const wasmDirectory = _path.default.join(_path.default.dirname(require.resolve('next/package.json')), 'wasm');
        if (!downloadWasmPromise) {
            downloadWasmPromise = require('../../lib/download-swc').downloadWasmSwc(nextVersion, wasmDirectory);
        }
        await downloadWasmPromise;
        let bindings = await loadWasm(wasmDirectory);
        require('../../telemetry/events/swc-load-failure').eventSwcLoadFailure({
            wasm: 'fallback',
            nativeBindingsErrorCode: lastNativeBindingsLoadErrorCode
        });
        // still log native load attempts so user is
        // aware it failed and should be fixed
        for (const attempt of attempts){
            _log.warn(attempt);
        }
        return bindings;
    } catch (a) {
        attempts.push(...[].concat(a));
    }
}
function loadBindingsSync() {
    let attempts = [];
    try {
        return loadNative();
    } catch (a) {
        attempts = attempts.concat(a);
    }
    // Fire-and-forget telemetry logging (loadBindingsSync must remain synchronous)
    // Worker error handler will await telemetry.flush() before exit
    logLoadFailure(attempts);
    throw Object.defineProperty(new Error('Failed to load bindings', {
        cause: attempts
    }), "__NEXT_ERROR_CODE", {
        value: "E424",
        enumerable: false,
        configurable: true
    });
}
let loggingLoadFailure = false;
/**
 * Logs SWC load failure telemetry and error messages.
 *
 * Note: Does NOT call process.exit() - errors must propagate to caller's error handler
 * which will await telemetry.flush() before exit (critical for worker threads with async telemetry).
 */ async function logLoadFailure(attempts, triedWasm = false) {
    // make sure we only emit the event and log the failure once
    if (loggingLoadFailure) return;
    loggingLoadFailure = true;
    for (let attempt of attempts){
        _log.warn(attempt);
    }
    await require('../../telemetry/events/swc-load-failure').eventSwcLoadFailure({
        wasm: triedWasm ? 'failed' : undefined,
        nativeBindingsErrorCode: lastNativeBindingsLoadErrorCode
    });
    await (lockfilePatchPromise.cur || Promise.resolve());
    _log.error(`Failed to load SWC binary for ${PlatformName}/${ArchName}, see more info here: https://nextjs.org/docs/messages/failed-loading-swc`);
}
function createDefineEnv({ isTurbopack, clientRouterFilters, config, dev, distDir, projectPath, fetchCacheKeyPrefix, hasRewrites, middlewareMatchers, rewrites }) {
    let defineEnv = {
        client: [],
        edge: [],
        nodejs: []
    };
    for (const variant of Object.keys(defineEnv)){
        defineEnv[variant] = rustifyOptionEnv((0, _defineenv.getDefineEnv)({
            isTurbopack,
            clientRouterFilters,
            config,
            dev,
            distDir,
            projectPath,
            fetchCacheKeyPrefix,
            hasRewrites,
            isClient: variant === 'client',
            isEdgeServer: variant === 'edge',
            isNodeServer: variant === 'nodejs',
            middlewareMatchers,
            rewrites
        }));
    }
    return defineEnv;
}
function rustifyEnv(env) {
    return Object.entries(env).filter(([_, value])=>value != null).map(([name, value])=>({
            name,
            value
        }));
}
function rustifyOptionEnv(env) {
    return Object.entries(env).map(([name, value])=>({
            name,
            value
        }));
}
const normalizePathOnWindows = (p)=>_path.default.sep === '\\' ? p.replace(/\\/g, '/') : p;
// TODO(sokra) Support wasm option.
function bindingToApi(binding, bindingPath, _wasm) {
    const cancel = new class Cancel extends Error {
    }();
    /**
   * Utility function to ensure all variants of an enum are handled.
   */ function invariant(never, computeMessage) {
        throw Object.defineProperty(new Error(`Invariant: ${computeMessage(never)}`), "__NEXT_ERROR_CODE", {
            value: "E193",
            enumerable: false,
            configurable: true
        });
    }
    /**
   * Calls a native function and streams the result.
   * If useBuffer is true, all values will be preserved, potentially buffered
   * if consumed slower than produced. Else, only the latest value will be
   * preserved.
   */ function subscribe(useBuffer, nativeFunction) {
        // A buffer of produced items. This will only contain values if the
        // consumer is slower than the producer.
        let buffer = [];
        // A deferred value waiting for the next produced item. This will only
        // exist if the consumer is faster than the producer.
        let waiting;
        let canceled = false;
        // The native function will call this every time it emits a new result. We
        // either need to notify a waiting consumer, or buffer the new result until
        // the consumer catches up.
        function emitResult(err, value) {
            if (waiting) {
                let { resolve, reject } = waiting;
                waiting = undefined;
                if (err) reject(err);
                else resolve(value);
            } else {
                const item = {
                    err,
                    value
                };
                if (useBuffer) buffer.push(item);
                else buffer[0] = item;
            }
        }
        async function* createIterator() {
            const task = await nativeFunction(emitResult);
            try {
                while(!canceled){
                    if (buffer.length > 0) {
                        const item = buffer.shift();
                        if (item.err) throw item.err;
                        yield item.value;
                    } else {
                        // eslint-disable-next-line no-loop-func
                        yield new Promise((resolve, reject)=>{
                            waiting = {
                                resolve,
                                reject
                            };
                        });
                    }
                }
            } catch (e) {
                if (e === cancel) return;
                throw e;
            } finally{
                if (task) {
                    binding.rootTaskDispose(task);
                }
            }
        }
        const iterator = createIterator();
        iterator.return = async ()=>{
            canceled = true;
            if (waiting) waiting.reject(cancel);
            return {
                value: undefined,
                done: true
            };
        };
        return iterator;
    }
    async function rustifyProjectOptions(options) {
        return {
            ...options,
            nextConfig: await serializeNextConfig(options.nextConfig, _path.default.join(options.rootPath, options.projectPath)),
            env: rustifyEnv(options.env)
        };
    }
    async function rustifyPartialProjectOptions(options) {
        return {
            ...options,
            nextConfig: options.nextConfig && await serializeNextConfig(options.nextConfig, _path.default.join(options.rootPath, options.projectPath)),
            env: options.env && rustifyEnv(options.env)
        };
    }
    class ProjectImpl {
        constructor(nativeProject){
            this._nativeProject = nativeProject;
            if (typeof binding.registerWorkerScheduler === 'function') {
                (0, _loaderWorkerPool.runLoaderWorkerPool)(binding, bindingPath);
            }
        }
        async update(options) {
            await binding.projectUpdate(this._nativeProject, await rustifyPartialProjectOptions(options));
        }
        async writeAnalyzeData(appDirOnly) {
            const napiResult = await binding.projectWriteAnalyzeData(this._nativeProject, appDirOnly);
            return napiResult;
        }
        async writeAllEntrypointsToDisk(appDirOnly) {
            const napiEndpoints = await binding.projectWriteAllEntrypointsToDisk(this._nativeProject, appDirOnly);
            if ('routes' in napiEndpoints) {
                return napiEntrypointsToRawEntrypoints(napiEndpoints);
            } else {
                return {
                    issues: napiEndpoints.issues,
                    diagnostics: napiEndpoints.diagnostics
                };
            }
        }
        entrypointsSubscribe() {
            const subscription = subscribe(false, async (callback)=>binding.projectEntrypointsSubscribe(this._nativeProject, callback));
            return async function*() {
                for await (const entrypoints of subscription){
                    if ('routes' in entrypoints) {
                        yield napiEntrypointsToRawEntrypoints(entrypoints);
                    } else {
                        yield {
                            issues: entrypoints.issues,
                            diagnostics: entrypoints.diagnostics
                        };
                    }
                }
            }();
        }
        hmrEvents(chunkName, target) {
            return subscribe(true, async (callback)=>binding.projectHmrEvents(this._nativeProject, chunkName, target, callback));
        }
        /**
     * Subscribe to the list of output chunk paths that can receive HMR updates.
     * Chunk paths are output file paths like "server/chunks/ssr/..._.js" for server
     * or "_next/static/chunks/app/page.js" for client.
     */ hmrChunkNamesSubscribe(target) {
            return subscribe(false, async (callback)=>binding.projectHmrChunkNamesSubscribe(this._nativeProject, target, callback));
        }
        traceSource(stackFrame, currentDirectoryFileUrl) {
            return binding.projectTraceSource(this._nativeProject, stackFrame, currentDirectoryFileUrl);
        }
        getSourceForAsset(filePath) {
            return binding.projectGetSourceForAsset(this._nativeProject, filePath);
        }
        getSourceMap(filePath) {
            return binding.projectGetSourceMap(this._nativeProject, filePath);
        }
        getSourceMapSync(filePath) {
            return binding.projectGetSourceMapSync(this._nativeProject, filePath);
        }
        updateInfoSubscribe(aggregationMs) {
            return subscribe(true, async (callback)=>binding.projectUpdateInfoSubscribe(this._nativeProject, aggregationMs, callback));
        }
        compilationEventsSubscribe(eventTypes) {
            return subscribe(true, async (callback)=>{
                binding.projectCompilationEventsSubscribe(this._nativeProject, callback, eventTypes);
            });
        }
        invalidateFileSystemCache() {
            return binding.projectInvalidateFileSystemCache(this._nativeProject);
        }
        shutdown() {
            return binding.projectShutdown(this._nativeProject);
        }
        onExit() {
            return binding.projectOnExit(this._nativeProject);
        }
    }
    class EndpointImpl {
        constructor(nativeEndpoint){
            this._nativeEndpoint = nativeEndpoint;
        }
        async writeToDisk() {
            return await binding.endpointWriteToDisk(this._nativeEndpoint);
        }
        async clientChanged() {
            const clientSubscription = subscribe(false, async (callback)=>binding.endpointClientChangedSubscribe(this._nativeEndpoint, callback));
            await clientSubscription.next();
            return clientSubscription;
        }
        async serverChanged(includeIssues) {
            const serverSubscription = subscribe(false, async (callback)=>binding.endpointServerChangedSubscribe(this._nativeEndpoint, includeIssues, callback));
            await serverSubscription.next();
            return serverSubscription;
        }
    }
    async function serializeNextConfig(nextConfig, projectPath) {
        // Avoid mutating the existing `nextConfig` object. NOTE: This is only a shallow clone.
        let nextConfigSerializable = {
            ...nextConfig
        };
        // These values are never read by Turbopack and are potentially non-serializable.
        nextConfigSerializable.exportPathMap = {};
        nextConfigSerializable.generateBuildId = nextConfigSerializable.generateBuildId && {};
        nextConfigSerializable.webpack = nextConfigSerializable.webpack && {};
        if (nextConfigSerializable.modularizeImports) {
            nextConfigSerializable.modularizeImports = Object.fromEntries(Object.entries(nextConfigSerializable.modularizeImports).map(([mod, config])=>[
                    mod,
                    {
                        ...config,
                        transform: typeof config.transform === 'string' ? config.transform : Object.entries(config.transform)
                    }
                ]));
        }
        // These are relative paths, but might be backslash-separated on Windows
        nextConfigSerializable.distDir = normalizePathOnWindows(nextConfigSerializable.distDir);
        nextConfigSerializable.distDirRoot = normalizePathOnWindows(nextConfigSerializable.distDirRoot);
        // loaderFile is an absolute path, we need it to be relative for turbopack.
        if (nextConfigSerializable.images.loaderFile) {
            nextConfigSerializable.images = {
                ...nextConfigSerializable.images,
                loaderFile: './' + normalizePathOnWindows(_path.default.relative(projectPath, nextConfigSerializable.images.loaderFile))
            };
        }
        // cacheHandler can be an absolute path, we need it to be relative for turbopack.
        if (nextConfigSerializable.cacheHandler) {
            nextConfigSerializable.cacheHandler = './' + normalizePathOnWindows(_path.default.isAbsolute(nextConfigSerializable.cacheHandler) ? _path.default.relative(projectPath, nextConfigSerializable.cacheHandler) : nextConfigSerializable.cacheHandler);
        }
        if (nextConfigSerializable.cacheHandlers) {
            nextConfigSerializable.cacheHandlers = Object.fromEntries(Object.entries(nextConfigSerializable.cacheHandlers).filter(([_, value])=>value != null).map(([key, value])=>[
                    key,
                    './' + normalizePathOnWindows(_path.default.isAbsolute(value) ? _path.default.relative(projectPath, value) : value)
                ]));
        }
        if (nextConfigSerializable.turbopack != null) {
            // clone to allow in-place mutations
            const turbopack = {
                ...nextConfigSerializable.turbopack
            };
            if (turbopack.rules) {
                turbopack.rules = serializeTurbopackRules(turbopack.rules);
            }
            // Serialize ignoreIssue rules: convert RegExp to {source, flags}
            if (turbopack.ignoreIssue) {
                function serializePatternField(value, stringType) {
                    if (value instanceof RegExp) {
                        return {
                            type: 'regex',
                            source: value.source,
                            flags: value.flags
                        };
                    }
                    return {
                        type: stringType,
                        value
                    };
                }
                turbopack.ignoreIssue = turbopack.ignoreIssue.map((rule)=>({
                        path: serializePatternField(rule.path, 'glob'),
                        title: rule.title != null ? serializePatternField(rule.title, 'string') : undefined,
                        description: rule.description != null ? serializePatternField(rule.description, 'string') : undefined
                    }));
            }
            nextConfigSerializable.turbopack = turbopack;
        }
        return JSON.stringify(nextConfigSerializable, null, 2);
    }
    // converts regexes to a `RegexComponents` object so that it can be JSON-serialized when passed to
    // Turbopack
    function serializeRuleCondition(cond) {
        function regexComponents(regex) {
            return {
                source: regex.source,
                flags: regex.flags
            };
        }
        if (typeof cond === 'string') {
            return cond;
        } else if ('all' in cond) {
            return {
                ...cond,
                all: cond.all.map(serializeRuleCondition)
            };
        } else if ('any' in cond) {
            return {
                ...cond,
                any: cond.any.map(serializeRuleCondition)
            };
        } else if ('not' in cond) {
            return {
                ...cond,
                not: serializeRuleCondition(cond.not)
            };
        } else {
            return {
                ...cond,
                path: cond.path == null ? undefined : cond.path instanceof RegExp ? {
                    type: 'regex',
                    value: regexComponents(cond.path)
                } : {
                    type: 'glob',
                    value: cond.path
                },
                content: cond.content && regexComponents(cond.content),
                query: cond.query == null ? undefined : cond.query instanceof RegExp ? {
                    type: 'regex',
                    value: regexComponents(cond.query)
                } : {
                    type: 'constant',
                    value: cond.query
                },
                contentType: cond.contentType == null ? undefined : cond.contentType instanceof RegExp ? {
                    type: 'regex',
                    value: regexComponents(cond.contentType)
                } : {
                    type: 'glob',
                    value: cond.contentType
                }
            };
        }
    }
    // Note: Returns an updated `turbopackRules` with serialized conditions. Does not mutate in-place.
    function serializeTurbopackRules(turbopackRules) {
        const serializedRules = {};
        for (const [glob, rule] of Object.entries(turbopackRules)){
            if (Array.isArray(rule)) {
                serializedRules[glob] = rule.map((item)=>{
                    if (typeof item !== 'string' && ('loaders' in item || 'type' in item || 'condition' in item)) {
                        return serializeConfigItem(item, glob);
                    } else {
                        checkLoaderItem(item, glob);
                        return item;
                    }
                });
            } else {
                serializedRules[glob] = serializeConfigItem(rule, glob);
            }
        }
        return serializedRules;
        function serializeConfigItem(rule, glob) {
            if (!rule) return rule;
            if (rule.loaders) {
                for (const item of rule.loaders){
                    checkLoaderItem(item, glob);
                }
            }
            let serializedRule = rule;
            if (rule.condition != null) {
                serializedRule = {
                    ...rule,
                    condition: serializeRuleCondition(rule.condition)
                };
            }
            return serializedRule;
        }
        function checkLoaderItem(loaderItem, glob) {
            if (typeof loaderItem !== 'string' && !require('util').isDeepStrictEqual(loaderItem, JSON.parse(JSON.stringify(loaderItem)))) {
                throw Object.defineProperty(new Error(`loader ${loaderItem.loader} for match "${glob}" does not have serializable options. ` + 'Ensure that options passed are plain JavaScript objects and values.'), "__NEXT_ERROR_CODE", {
                    value: "E491",
                    enumerable: false,
                    configurable: true
                });
            }
        }
    }
    function napiEntrypointsToRawEntrypoints(entrypoints) {
        const routes = new Map();
        for (const { pathname, ...nativeRoute } of entrypoints.routes){
            let route;
            const routeType = nativeRoute.type;
            switch(routeType){
                case 'page':
                    route = {
                        type: 'page',
                        htmlEndpoint: new EndpointImpl(nativeRoute.htmlEndpoint),
                        dataEndpoint: new EndpointImpl(nativeRoute.dataEndpoint)
                    };
                    break;
                case 'page-api':
                    route = {
                        type: 'page-api',
                        endpoint: new EndpointImpl(nativeRoute.endpoint)
                    };
                    break;
                case 'app-page':
                    route = {
                        type: 'app-page',
                        pages: nativeRoute.pages.map((page)=>({
                                originalName: page.originalName,
                                htmlEndpoint: new EndpointImpl(page.htmlEndpoint),
                                rscEndpoint: new EndpointImpl(page.rscEndpoint)
                            }))
                    };
                    break;
                case 'app-route':
                    route = {
                        type: 'app-route',
                        originalName: nativeRoute.originalName,
                        endpoint: new EndpointImpl(nativeRoute.endpoint)
                    };
                    break;
                case 'conflict':
                    route = {
                        type: 'conflict'
                    };
                    break;
                default:
                    {
                        const _exhaustiveCheck = routeType;
                        invariant(nativeRoute, ()=>`Unknown route type: ${_exhaustiveCheck}`);
                    }
            }
            routes.set(pathname, route);
        }
        const napiMiddlewareToMiddleware = (middleware)=>({
                endpoint: new EndpointImpl(middleware.endpoint),
                isProxy: middleware.isProxy
            });
        const middleware = entrypoints.middleware ? napiMiddlewareToMiddleware(entrypoints.middleware) : undefined;
        const napiInstrumentationToInstrumentation = (instrumentation)=>({
                nodeJs: new EndpointImpl(instrumentation.nodeJs),
                edge: new EndpointImpl(instrumentation.edge)
            });
        const instrumentation = entrypoints.instrumentation ? napiInstrumentationToInstrumentation(entrypoints.instrumentation) : undefined;
        return {
            routes,
            middleware,
            instrumentation,
            pagesDocumentEndpoint: new EndpointImpl(entrypoints.pagesDocumentEndpoint),
            pagesAppEndpoint: new EndpointImpl(entrypoints.pagesAppEndpoint),
            pagesErrorEndpoint: new EndpointImpl(entrypoints.pagesErrorEndpoint),
            issues: entrypoints.issues,
            diagnostics: entrypoints.diagnostics
        };
    }
    return async function createProject(options, turboEngineOptions, callbacks) {
        return new ProjectImpl(await binding.projectNew(await rustifyProjectOptions(options), turboEngineOptions || {}, {
            throwTurbopackInternalError: require('../../shared/lib/turbopack/internal-error').throwTurbopackInternalError,
            onBeforeDeferredEntries: callbacks == null ? void 0 : callbacks.onBeforeDeferredEntries
        }));
    };
}
// helper for loadWasm
async function loadWasmRawBindings(importPath = '') {
    let attempts = [];
    // Used by `run-tests` to force use of a locally-built wasm binary. This environment variable is
    // unstable and subject to change.
    const testWasmDir = process.env.NEXT_TEST_WASM_DIR;
    if (testWasmDir) {
        // assume these are node.js bindings and don't need a call to `.default()`
        const rawBindings = await import((0, _url.pathToFileURL)(_path.default.join(testWasmDir, 'wasm.js')).toString());
        infoLog(`next-swc build: wasm build ${testWasmDir}`);
        return rawBindings;
    } else {
        for (let pkg of [
            '@next/swc-wasm-nodejs',
            '@next/swc-wasm-web'
        ]){
            try {
                let pkgPath = pkg;
                if (importPath) {
                    // the import path must be exact when not in node_modules
                    pkgPath = _path.default.join(importPath, pkg, 'wasm.js');
                }
                const importedRawBindings = await import((0, _url.pathToFileURL)(pkgPath).toString());
                let rawBindings;
                if (pkg === '@next/swc-wasm-web') {
                    // https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html
                    // `default` must be called to initialize the module
                    rawBindings = await importedRawBindings.default();
                } else {
                    rawBindings = importedRawBindings;
                }
                infoLog(`next-swc build: wasm build ${pkg}`);
                return rawBindings;
            } catch (e) {
                // Only log attempts for loading wasm when loading as fallback
                if (importPath) {
                    if ((e == null ? void 0 : e.code) === 'ERR_MODULE_NOT_FOUND') {
                        attempts.push(`Attempted to load ${pkg}, but it was not installed`);
                    } else {
                        attempts.push(`Attempted to load ${pkg}, but an error occurred: ${e.message ?? e}`);
                    }
                }
            }
        }
    }
    throw attempts;
}
// helper for tryLoadWasmWithFallback / loadBindings.
async function loadWasm(importPath = '') {
    const rawBindings = await loadWasmRawBindings(importPath);
    function removeUndefined(obj) {
        // serde-wasm-bindgen expect that `undefined` values map to `()` in rust, but we want to treat
        // those fields as non-existent, so remove them before passing them to rust.
        //
        // The native (non-wasm) bindings use `JSON.stringify`, which strips undefined values.
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(removeUndefined);
        }
        const newObj = {};
        for (const [k, v] of Object.entries(obj)){
            if (typeof v !== 'undefined') {
                newObj[k] = removeUndefined(v);
            }
        }
        return newObj;
    }
    // Note wasm binary does not support async intefaces yet, all async
    // interface coereces to sync interfaces.
    let wasmBindings = {
        css: {
            lightning: {
                transform: function(_options) {
                    throw Object.defineProperty(new Error('`css.lightning.transform` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                        value: "E330",
                        enumerable: false,
                        configurable: true
                    });
                },
                transformStyleAttr: function(_options) {
                    throw Object.defineProperty(new Error('`css.lightning.transformStyleAttr` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                        value: "E324",
                        enumerable: false,
                        configurable: true
                    });
                },
                featureNamesToMask: function(_names) {
                    throw Object.defineProperty(new Error('`css.lightning.featureNamesToMask` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                        value: "E1090",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
        },
        isWasm: true,
        transform (src, options) {
            return rawBindings.transform(src.toString(), removeUndefined(options));
        },
        transformSync (src, options) {
            return rawBindings.transformSync(src.toString(), removeUndefined(options));
        },
        minify (src, options) {
            return rawBindings.minify(src.toString(), removeUndefined(options));
        },
        minifySync (src, options) {
            return rawBindings.minifySync(src.toString(), removeUndefined(options));
        },
        parse (src, options) {
            return rawBindings.parse(src.toString(), removeUndefined(options));
        },
        getTargetTriple () {
            return undefined;
        },
        turbo: {
            createProject (_options, _turboEngineOptions, _callbacks) {
                throw Object.defineProperty(new Error(`Turbopack is not supported on this platform (${PlatformName}/${ArchName}) because native bindings are not available. ` + `Only WebAssembly (WASM) bindings were loaded, and Turbopack requires native bindings. ` + `Use the --webpack flag instead.`), "__NEXT_ERROR_CODE", {
                    value: "E1052",
                    enumerable: false,
                    configurable: true
                });
            },
            startTurbopackTraceServer (_traceFilePath, _port) {
                throw Object.defineProperty(new Error(`Turbopack trace server is not supported on this platform (${PlatformName}/${ArchName}) because native bindings are not available. ` + `Only WebAssembly (WASM) bindings were loaded, and Turbopack requires native bindings.`), "__NEXT_ERROR_CODE", {
                    value: "E1051",
                    enumerable: false,
                    configurable: true
                });
            }
        },
        mdx: {
            compile (src, options) {
                return rawBindings.mdxCompile(src, removeUndefined(getMdxOptions(options)));
            },
            compileSync (src, options) {
                return rawBindings.mdxCompileSync(src, removeUndefined(getMdxOptions(options)));
            }
        },
        reactCompiler: {
            isReactCompilerRequired (_filename) {
                return Promise.resolve(true);
            }
        },
        rspack: {
            getModuleNamedExports (_resourcePath) {
                throw Object.defineProperty(new Error('`rspack.getModuleNamedExports` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                    value: "E709",
                    enumerable: false,
                    configurable: true
                });
            },
            warnForEdgeRuntime (_source, _isProduction) {
                throw Object.defineProperty(new Error('`rspack.warnForEdgeRuntime` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                    value: "E712",
                    enumerable: false,
                    configurable: true
                });
            }
        },
        expandNextJsTemplate (content, templatePath, nextPackageDirPath, replacements, injections, imports) {
            return rawBindings.expandNextJsTemplate(content, templatePath, nextPackageDirPath, replacements, injections, imports);
        },
        codeFrameColumns (source, location, options) {
            return rawBindings.codeFrameColumns(Buffer.from(source), location, options);
        },
        lockfileTryAcquire (_filePath, _content) {
            throw Object.defineProperty(new Error('`lockfileTryAcquire` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                value: "E855",
                enumerable: false,
                configurable: true
            });
        },
        lockfileTryAcquireSync (_filePath, _content) {
            throw Object.defineProperty(new Error('`lockfileTryAcquireSync` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                value: "E856",
                enumerable: false,
                configurable: true
            });
        },
        lockfileUnlock (_lockfile) {
            throw Object.defineProperty(new Error('`lockfileUnlock` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                value: "E857",
                enumerable: false,
                configurable: true
            });
        },
        lockfileUnlockSync (_lockfile) {
            throw Object.defineProperty(new Error('`lockfileUnlockSync` is not supported by the wasm bindings.'), "__NEXT_ERROR_CODE", {
                value: "E858",
                enumerable: false,
                configurable: true
            });
        }
    };
    return wasmBindings;
}
/**
 * Loads the native (non-wasm) bindings. Prefer `loadBindings` over this API, as that includes a
 * wasm fallback.
 */ function loadNative(importPath) {
    if (loadedBindings) {
        return loadedBindings;
    }
    if (process.env.NEXT_TEST_WASM) {
        throw Object.defineProperty(new Error('cannot run loadNative when `NEXT_TEST_WASM` is set'), "__NEXT_ERROR_CODE", {
            value: "E714",
            enumerable: false,
            configurable: true
        });
    }
    const customBindingsPath = !!__INTERNAL_CUSTOM_TURBOPACK_BINDINGS ? require.resolve(__INTERNAL_CUSTOM_TURBOPACK_BINDINGS) : null;
    const customBindings = customBindingsPath != null ? require(customBindingsPath) : null;
    let bindings = customBindings;
    let bindingsPath = customBindingsPath;
    // callers expect that if loadNative throws, it's an array of strings.
    let attempts = [];
    const NEXT_TEST_NATIVE_DIR = process.env.NEXT_TEST_NATIVE_DIR;
    for (const triple of triples){
        if (NEXT_TEST_NATIVE_DIR) {
            try {
                const bindingForTest = `${NEXT_TEST_NATIVE_DIR}/next-swc.${triple.platformArchABI}.node`;
                // Use the binary directly to skip `pnpm pack` for testing as it's slow because of the large native binary.
                bindingsPath = require.resolve(bindingForTest);
                bindings = require(bindingsPath);
                infoLog('next-swc build: local built @next/swc from NEXT_TEST_NATIVE_DIR');
                break;
            } catch (e) {
                attempts.push(`Failed to load triple ${triple.platformArchABI}: ${e.message ?? e}`);
            }
        } else if (process.env.NEXT_TEST_NATIVE_IGNORE_LOCAL_INSTALL !== 'true') {
            try {
                const normalBinding = `@next/swc/native/next-swc.${triple.platformArchABI}.node`;
                bindings = require(normalBinding);
                bindingsPath = require.resolve(normalBinding);
                infoLog('next-swc build: local built @next/swc');
                break;
            } catch (e) {}
        }
    }
    if (!bindings) {
        if (NEXT_TEST_NATIVE_DIR) {
            throw attempts;
        }
        for (const triple of triples){
            let pkg = importPath ? _path.default.join(importPath, `@next/swc-${triple.platformArchABI}`, `next-swc.${triple.platformArchABI}.node`) : `@next/swc-${triple.platformArchABI}`;
            try {
                bindings = require(pkg);
                bindingsPath = require.resolve(pkg);
                if (!importPath) {
                    checkVersionMismatch(require(`${pkg}/package.json`));
                }
                break;
            } catch (e) {
                if ((e == null ? void 0 : e.code) === 'MODULE_NOT_FOUND') {
                    attempts.push(`Attempted to load ${pkg}, but it was not installed`);
                } else {
                    attempts.push(`Attempted to load ${pkg}, but an error occurred: ${e.message ?? e}`);
                }
                lastNativeBindingsLoadErrorCode = (e == null ? void 0 : e.code) ?? 'unknown';
            }
        }
    }
    if (bindings) {
        loadedBindings = {
            isWasm: false,
            transform (src, options) {
                var _options_jsc;
                const isModule = typeof src !== 'undefined' && typeof src !== 'string' && !Buffer.isBuffer(src);
                options = options || {};
                if (options == null ? void 0 : (_options_jsc = options.jsc) == null ? void 0 : _options_jsc.parser) {
                    options.jsc.parser.syntax = options.jsc.parser.syntax ?? 'ecmascript';
                }
                return bindings.transform(isModule ? JSON.stringify(src) : src, isModule, toBuffer(options));
            },
            transformSync (src, options) {
                var _options_jsc;
                if (typeof src === 'undefined') {
                    throw Object.defineProperty(new Error("transformSync doesn't implement reading the file from filesystem"), "__NEXT_ERROR_CODE", {
                        value: "E292",
                        enumerable: false,
                        configurable: true
                    });
                } else if (Buffer.isBuffer(src)) {
                    throw Object.defineProperty(new Error("transformSync doesn't implement taking the source code as Buffer"), "__NEXT_ERROR_CODE", {
                        value: "E387",
                        enumerable: false,
                        configurable: true
                    });
                }
                const isModule = typeof src !== 'string';
                options = options || {};
                if (options == null ? void 0 : (_options_jsc = options.jsc) == null ? void 0 : _options_jsc.parser) {
                    options.jsc.parser.syntax = options.jsc.parser.syntax ?? 'ecmascript';
                }
                return bindings.transformSync(isModule ? JSON.stringify(src) : src, isModule, toBuffer(options));
            },
            minify (src, options) {
                return bindings.minify(Buffer.from(src), toBuffer(options ?? {}));
            },
            minifySync (src, options) {
                return bindings.minifySync(Buffer.from(src), toBuffer(options ?? {}));
            },
            parse (src, options) {
                return bindings.parse(src, toBuffer(options ?? {}));
            },
            getTargetTriple: bindings.getTargetTriple,
            initCustomTraceSubscriber: bindings.initCustomTraceSubscriber,
            teardownTraceSubscriber: bindings.teardownTraceSubscriber,
            turbo: {
                createProject: bindingToApi(customBindings ?? bindings, customBindingsPath ?? bindingsPath, false),
                startTurbopackTraceServer (traceFilePath, port) {
                    _log.warn(`Turbopack trace server started. View trace at https://trace.nextjs.org${port != null ? `?port=${port}` : ''}`);
                    (customBindings ?? bindings).startTurbopackTraceServer(traceFilePath, port);
                }
            },
            mdx: {
                compile (src, options) {
                    return bindings.mdxCompile(src, toBuffer(getMdxOptions(options)));
                },
                compileSync (src, options) {
                    bindings.mdxCompileSync(src, toBuffer(getMdxOptions(options)));
                }
            },
            css: {
                lightning: {
                    transform (transformOptions) {
                        return bindings.lightningCssTransform(transformOptions);
                    },
                    transformStyleAttr (transformAttrOptions) {
                        return bindings.lightningCssTransformStyleAttribute(transformAttrOptions);
                    },
                    featureNamesToMask (names) {
                        return bindings.lightningcssFeatureNamesToMaskNapi(names);
                    }
                }
            },
            reactCompiler: {
                isReactCompilerRequired: (filename)=>{
                    return bindings.isReactCompilerRequired(filename);
                }
            },
            rspack: {
                getModuleNamedExports: function(resourcePath) {
                    return bindings.getModuleNamedExports(resourcePath);
                },
                warnForEdgeRuntime: function(source, isProduction) {
                    return bindings.warnForEdgeRuntime(source, isProduction);
                }
            },
            expandNextJsTemplate (content, templatePath, nextPackageDirPath, replacements, injections, imports) {
                return bindings.expandNextJsTemplate(content, templatePath, nextPackageDirPath, replacements, injections, imports);
            },
            lockfileTryAcquire (filePath, content) {
                return bindings.lockfileTryAcquire(filePath, content);
            },
            lockfileTryAcquireSync (filePath, content) {
                return bindings.lockfileTryAcquireSync(filePath, content);
            },
            lockfileUnlock (lockfile) {
                return bindings.lockfileUnlock(lockfile);
            },
            lockfileUnlockSync (lockfile) {
                return bindings.lockfileUnlockSync(lockfile);
            },
            codeFrameColumns (source, location, options) {
                // napi-rs translates Option::None as null but wasm-bindgen translates it to `null`
                // convert here for consistency
                return bindings.codeFrameColumns(source, location, options) ?? undefined;
            }
        };
        return loadedBindings;
    }
    throw attempts;
}
/// Build a mdx options object contains default values that
/// can be parsed with serde_wasm_bindgen.
function getMdxOptions(options = {}) {
    return {
        ...options,
        development: options.development ?? false,
        jsx: options.jsx ?? false,
        mdxType: options.mdxType ?? 'commonMark'
    };
}
function toBuffer(t) {
    return Buffer.from(JSON.stringify(t));
}
async function transform(src, options) {
    let bindings = getBindingsSync();
    return bindings.transform(src, options);
}
function transformSync(src, options) {
    const bindings = loadBindingsSync();
    return bindings.transformSync(src, options);
}
function minify(src, options) {
    const bindings = getBindingsSync();
    return bindings.minify(src, options);
}
function isReactCompilerRequired(filename) {
    const bindings = getBindingsSync();
    return bindings.reactCompiler.isReactCompilerRequired(filename);
}
async function parse(src, options) {
    const bindings = getBindingsSync();
    const parserOptions = require('./options').getParserOptions(options);
    const parsed = await bindings.parse(src, parserOptions);
    return JSON.parse(parsed);
}
function getBinaryMetadata() {
    var _loadedBindings_getTargetTriple;
    return {
        target: loadedBindings == null ? void 0 : (_loadedBindings_getTargetTriple = loadedBindings.getTargetTriple) == null ? void 0 : _loadedBindings_getTargetTriple.call(loadedBindings)
    };
}
function initCustomTraceSubscriber(traceFileName) {
    if (!swcTraceFlushGuard) {
        var _getBindingsSync_initCustomTraceSubscriber, _getBindingsSync;
        // Wasm binary doesn't support trace emission
        swcTraceFlushGuard = (_getBindingsSync_initCustomTraceSubscriber = (_getBindingsSync = getBindingsSync()).initCustomTraceSubscriber) == null ? void 0 : _getBindingsSync_initCustomTraceSubscriber.call(_getBindingsSync, traceFileName);
    }
}
function once(fn) {
    let executed = false;
    return function() {
        if (!executed) {
            executed = true;
            fn();
        }
    };
}
const teardownTraceSubscriber = once(()=>{
    try {
        if (swcTraceFlushGuard) {
            var _getBindingsSync_teardownTraceSubscriber, _getBindingsSync;
            (_getBindingsSync_teardownTraceSubscriber = (_getBindingsSync = getBindingsSync()).teardownTraceSubscriber) == null ? void 0 : _getBindingsSync_teardownTraceSubscriber.call(_getBindingsSync, swcTraceFlushGuard);
        }
    } catch (e) {
    // Suppress exceptions, this fn allows to fail to load native bindings
    }
});
async function getModuleNamedExports(resourcePath) {
    return getBindingsSync().rspack.getModuleNamedExports(resourcePath);
}
async function warnForEdgeRuntime(source, isProduction) {
    return getBindingsSync().rspack.warnForEdgeRuntime(source, isProduction);
}

//# sourceMappingURL=index.js.map