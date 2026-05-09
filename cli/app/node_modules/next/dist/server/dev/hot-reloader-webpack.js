"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    default: null,
    renderScriptError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    default: function() {
        return HotReloaderWebpack;
    },
    renderScriptError: function() {
        return renderScriptError;
    }
});
const _webpack = require("next/dist/compiled/webpack/webpack");
const _middlewarewebpack = require("./middleware-webpack");
const _hotmiddleware = require("./hot-middleware");
const _inspector = /*#__PURE__*/ _interop_require_wildcard(require("inspector"));
const _path = require("path");
const _entries = require("../../build/entries");
const _routediscovery = require("../../build/route-discovery");
const _getstaticinfoincludinglayouts = require("../../build/get-static-info-including-layouts");
const _output = require("../../build/output");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../build/output/log"));
const _webpackconfig = /*#__PURE__*/ _interop_require_wildcard(require("../../build/webpack-config"));
const _constants = require("../../lib/constants");
const _recursivedelete = require("../../lib/recursive-delete");
const _constants1 = require("../../shared/lib/constants");
const _findpagefile = require("../lib/find-page-file");
const _ondemandentryhandler = require("./on-demand-entry-handler");
const _denormalizepagepath = require("../../shared/lib/page-path/denormalize-page-path");
const _normalizepathsep = require("../../shared/lib/page-path/normalize-path-sep");
const _getroutefromentrypoint = /*#__PURE__*/ _interop_require_default(require("../get-route-from-entrypoint"));
const _utils = require("../../build/utils");
const _utils1 = require("../../shared/lib/utils");
const _trace = require("../../trace");
const _iserror = require("../../lib/is-error");
const _ws = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/ws"));
const _fs = require("fs");
const _isapiroute = require("../../lib/is-api-route");
const _nextrouteloader = require("../../build/webpack/loaders/next-route-loader");
const _isinternalcomponent = require("../../lib/is-internal-component");
const _routekind = require("../route-kind");
const _hotreloadertypes = require("./hot-reloader-types");
const _pagetypes = require("../../lib/page-types");
const _messages = require("./messages");
const _getnexterrorfeedbackmiddleware = require("../../next-devtools/server/get-next-error-feedback-middleware");
const _getdevoverlayfontmiddleware = require("../../next-devtools/server/font/get-dev-overlay-font-middleware");
const _devindicatormiddleware = require("../../next-devtools/server/dev-indicator-middleware");
const _getwebpackbundler = /*#__PURE__*/ _interop_require_default(require("../../shared/lib/get-webpack-bundler"));
const _restartdevservermiddleware = require("../../next-devtools/server/restart-dev-server-middleware");
const _cacheinvalidation = require("../../build/webpack/cache-invalidation");
const _receivelogs = require("./browser-logs/receive-logs");
const _devtoolsconfigmiddleware = require("../../next-devtools/server/devtools-config-middleware");
const _attachnodejsdebuggermiddleware = require("../../next-devtools/server/attach-nodejs-debugger-middleware");
const _invarianterror = require("../../shared/lib/invariant-error");
const _debugchannel = require("./debug-channel");
const _hotreloadersharedutils = require("./hot-reloader-shared-utils");
const _getmcpmiddleware = require("../mcp/get-mcp-middleware");
const _formaterrors = require("../mcp/tools/utils/format-errors");
const _mcptelemetrytracker = require("../mcp/mcp-telemetry-tracker");
const _filelogger = require("./browser-logs/file-logger");
const _serializederrors = require("./serialized-errors");
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
const MILLISECONDS_IN_NANOSECOND = BigInt(1000000);
function diff(a, b) {
    return new Set([
        ...a
    ].filter((v)=>!b.has(v)));
}
const wsServer = new _ws.default.Server({
    noServer: true
});
async function renderScriptError(res, error, { verbose = true } = {}) {
    // Asks CDNs and others to not to cache the errored page
    res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
    if (error.code === 'ENOENT') {
        return {
            finished: undefined
        };
    }
    if (verbose) {
        console.error(error.stack);
    }
    res.statusCode = 500;
    res.end('500 - Internal Error');
    return {
        finished: true
    };
}
function addCorsSupport(req, res) {
    // Only rewrite CORS handling when URL matches a hot-reloader middleware
    if (!req.url.startsWith('/__next')) {
        return {
            preflight: false
        };
    }
    if (!req.headers.origin) {
        return {
            preflight: false
        };
    }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
    // Based on https://github.com/primus/access-control/blob/4cf1bc0e54b086c91e6aa44fb14966fa5ef7549c/index.js#L158
    if (req.headers['access-control-request-headers']) {
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
    }
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return {
            preflight: true
        };
    }
    return {
        preflight: false
    };
}
// Iteratively look up the issuer till it ends up at the root
function findEntryModule(module1, compilation) {
    for(;;){
        const issuer = compilation.moduleGraph.getIssuer(module1);
        if (!issuer) return module1;
        module1 = issuer;
    }
}
function erroredPages(compilation) {
    const failedPages = {};
    for (const error of compilation.errors){
        if (!error.module) {
            continue;
        }
        const entryModule = findEntryModule(error.module, compilation);
        const { name } = entryModule;
        if (!name) {
            continue;
        }
        // Only pages have to be reloaded
        const enhancedName = (0, _getroutefromentrypoint.default)(name);
        if (!enhancedName) {
            continue;
        }
        if (!failedPages[enhancedName]) {
            failedPages[enhancedName] = [];
        }
        failedPages[enhancedName].push(error);
    }
    return failedPages;
}
class HotReloaderWebpack {
    constructor(dir, { config, isSrcDir, pagesDir, distDir, buildId, encryptionKey, previewProps, rewrites, appDir, telemetry, resetFetch, lockfile, onDevServerCleanup }){
        this.clientError = null;
        this.serverError = null;
        this.hmrServerError = null;
        this.pagesMapping = {};
        this.versionInfo = {
            staleness: 'unknown',
            installed: '0.0.0'
        };
        this.reloadAfterInvalidation = false;
        this.cacheStatusesByRequestId = new Map();
        this.hasAppRouterEntrypoints = false;
        this.hasPagesRouterEntrypoints = false;
        this.buildId = buildId;
        this.encryptionKey = encryptionKey;
        this.dir = dir;
        this.isSrcDir = isSrcDir;
        this.middlewares = [];
        this.pagesDir = pagesDir;
        this.appDir = appDir;
        this.distDir = distDir;
        this.clientStats = null;
        this.serverStats = null;
        this.edgeServerStats = null;
        this.serverPrevDocumentHash = null;
        this.telemetry = telemetry;
        this.resetFetch = resetFetch;
        this.lockfile = lockfile;
        this.config = config;
        this.previewProps = previewProps;
        this.rewrites = rewrites;
        this.hotReloaderSpan = (0, _trace.trace)('hot-reloader', undefined, {
            version: "16.2.1"
        });
        // Ensure the hotReloaderSpan is flushed immediately as it's the parentSpan for all processing
        // of the current `next dev` invocation.
        this.hotReloaderSpan.stop();
        // Initialize log monitor for file logging
        // Enable logging by default in development mode
        const mcpServerEnabled = !!config.experimental.mcpServer;
        const fileLogger = (0, _filelogger.getFileLogger)();
        fileLogger.initialize(this.distDir, mcpServerEnabled);
        onDevServerCleanup == null ? void 0 : onDevServerCleanup(async ()=>{
            await (lockfile == null ? void 0 : lockfile.unlock());
        });
    }
    async run(req, res, parsedUrl) {
        // Usually CORS support is not needed for the hot-reloader (this is dev only feature)
        // With when the app runs for multi-zones support behind a proxy,
        // the current page is trying to access this URL via assetPrefix.
        // That's when the CORS support is needed.
        const { preflight } = addCorsSupport(req, res);
        if (preflight) {
            return {};
        }
        // When a request comes in that is a page bundle, e.g. /_next/static/<buildid>/pages/index.js
        // we have to compile the page using on-demand-entries, this middleware will handle doing that
        // by adding the page to on-demand-entries, waiting till it's done
        // and then the bundle will be served like usual by the actual route in server/index.js
        const handlePageBundleRequest = async (pageBundleRes, parsedPageBundleUrl)=>{
            const { pathname } = parsedPageBundleUrl;
            if (!pathname) return {};
            const params = (0, _hotreloadersharedutils.matchNextPageBundleRequest)(pathname);
            if (!params) return {};
            let decodedPagePath;
            try {
                decodedPagePath = `/${params.path.map((param)=>decodeURIComponent(param)).join('/')}`;
            } catch (_) {
                throw Object.defineProperty(new _utils1.DecodeError('failed to decode param'), "__NEXT_ERROR_CODE", {
                    value: "E528",
                    enumerable: false,
                    configurable: true
                });
            }
            const page = (0, _denormalizepagepath.denormalizePagePath)(decodedPagePath);
            if (page === '/_error' || _constants1.BLOCKED_PAGES.indexOf(page) === -1) {
                try {
                    await this.ensurePage({
                        page,
                        clientOnly: true,
                        url: req.url
                    });
                } catch (error) {
                    return await renderScriptError(pageBundleRes, (0, _iserror.getProperError)(error));
                }
                const errors = await this.getCompilationErrors(page);
                if (errors.length > 0) {
                    return await renderScriptError(pageBundleRes, errors[0], {
                        verbose: false
                    });
                }
            }
            return {};
        };
        const { finished } = await handlePageBundleRequest(res, parsedUrl);
        for (const middleware of this.middlewares){
            let calledNext = false;
            await middleware(req, res, ()=>{
                calledNext = true;
            });
            if (!calledNext) {
                return {
                    finished: true
                };
            }
        }
        return {
            finished
        };
    }
    setHmrServerError(error) {
        this.hmrServerError = error;
    }
    clearHmrServerError() {
        if (this.hmrServerError) {
            this.setHmrServerError(null);
            this.send({
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                data: 'clear hmr server error'
            });
        }
    }
    async refreshServerComponents(hash) {
        this.send({
            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_COMPONENT_CHANGES,
            hash
        });
    }
    onHMR(req, _socket, head, callback) {
        wsServer.handleUpgrade(req, req.socket, head, (client)=>{
            var _this_onDemandEntries;
            const htmlRequestId = req.url ? new URL(req.url, 'http://n').searchParams.get('id') : null;
            if (!this.webpackHotMiddleware) {
                throw Object.defineProperty(new _invarianterror.InvariantError('Did not start HotReloaderWebpack.'), "__NEXT_ERROR_CODE", {
                    value: "E804",
                    enumerable: false,
                    configurable: true
                });
            }
            this.webpackHotMiddleware.onHMR(client, htmlRequestId);
            (_this_onDemandEntries = this.onDemandEntries) == null ? void 0 : _this_onDemandEntries.onHMR(client, ()=>this.hmrServerError);
            const enableCacheComponents = this.config.cacheComponents;
            // Clients with a request ID are inferred App Router clients. If Cache
            // Components is not enabled, we consider those legacy clients. Pages
            // Router clients are also considered legacy clients. TODO: Maybe mark
            // clients as App Router / Pages Router clients explicitly, instead of
            // inferring it from the presence of a request ID.
            const isLegacyClient = !htmlRequestId || !enableCacheComponents;
            callback(client, {
                isLegacyClient
            });
            client.addEventListener('message', async ({ data })=>{
                data = typeof data !== 'string' ? data.toString() : data;
                try {
                    const payload = JSON.parse(data);
                    let traceChild;
                    switch(payload.event){
                        case 'span-end':
                            {
                                traceChild = {
                                    name: payload.spanName,
                                    startTime: BigInt(Math.floor(payload.startTime)) * MILLISECONDS_IN_NANOSECOND,
                                    attrs: payload.attributes,
                                    endTime: BigInt(Math.floor(payload.endTime)) * MILLISECONDS_IN_NANOSECOND
                                };
                                break;
                            }
                        case 'client-hmr-latency':
                            {
                                traceChild = {
                                    name: payload.event,
                                    startTime: BigInt(payload.startTime) * MILLISECONDS_IN_NANOSECOND,
                                    endTime: BigInt(payload.endTime) * MILLISECONDS_IN_NANOSECOND,
                                    attrs: {
                                        updatedModules: payload.updatedModules.map((m)=>m.replace(`(${_constants.WEBPACK_LAYERS.appPagesBrowser})/`, '').replace(/^\.\//, '[project]/')),
                                        page: payload.page,
                                        isPageHidden: payload.isPageHidden
                                    }
                                };
                                break;
                            }
                        case 'client-reload-page':
                        case 'client-success':
                            {
                                traceChild = {
                                    name: payload.event
                                };
                                break;
                            }
                        case 'client-error':
                            {
                                traceChild = {
                                    name: payload.event,
                                    attrs: {
                                        errorCount: payload.errorCount
                                    }
                                };
                                break;
                            }
                        case 'client-warning':
                            {
                                traceChild = {
                                    name: payload.event,
                                    attrs: {
                                        warningCount: payload.warningCount
                                    }
                                };
                                break;
                            }
                        case 'client-removed-page':
                        case 'client-added-page':
                            {
                                traceChild = {
                                    name: payload.event,
                                    attrs: {
                                        page: payload.page || ''
                                    }
                                };
                                break;
                            }
                        case 'client-full-reload':
                            {
                                const { event, stackTrace, hadRuntimeError } = payload;
                                traceChild = {
                                    name: event,
                                    attrs: {
                                        stackTrace: stackTrace ?? ''
                                    }
                                };
                                if (hadRuntimeError) {
                                    _log.warn(_messages.FAST_REFRESH_RUNTIME_RELOAD);
                                    break;
                                }
                                let fileMessage = '';
                                if (stackTrace) {
                                    var _exec;
                                    const file = (_exec = /Aborted because (.+) is not accepted/.exec(stackTrace)) == null ? void 0 : _exec[1];
                                    if (file) {
                                        // `file` is filepath in `pages/` but it can be a webpack url.
                                        // If it's a webpack loader URL, it will include the app-pages layer
                                        if (file.startsWith(`(${_constants.WEBPACK_LAYERS.appPagesBrowser})/`)) {
                                            const fileUrl = new URL(file, 'file://');
                                            const cwd = process.cwd();
                                            const modules = fileUrl.searchParams.getAll('modules').map((filepath)=>filepath.slice(cwd.length + 1)).filter((filepath)=>!filepath.startsWith('node_modules'));
                                            if (modules.length > 0) {
                                                fileMessage = ` when ${modules.join(', ')} changed`;
                                            }
                                        } else if (// Handle known webpack layers
                                        file.startsWith(`(${_constants.WEBPACK_LAYERS.pagesDirBrowser})/`)) {
                                            const cleanedFilePath = file.slice(`(${_constants.WEBPACK_LAYERS.pagesDirBrowser})/`.length);
                                            fileMessage = ` when ${cleanedFilePath} changed`;
                                        } else {
                                            fileMessage = ` when ${file} changed`;
                                        }
                                    }
                                }
                                _log.warn(`Fast Refresh had to perform a full reload${fileMessage}. Read more: https://nextjs.org/docs/messages/fast-refresh-reload`);
                                break;
                            }
                        case 'browser-logs':
                            {
                                const browserToTerminalConfig = this.config.logging && this.config.logging.browserToTerminal;
                                if (browserToTerminalConfig) {
                                    await (0, _receivelogs.receiveBrowserLogsWebpack)({
                                        entries: payload.entries,
                                        router: payload.router,
                                        sourceType: payload.sourceType,
                                        clientStats: ()=>this.clientStats,
                                        serverStats: ()=>this.serverStats,
                                        edgeServerStats: ()=>this.edgeServerStats,
                                        rootDirectory: this.dir,
                                        distDir: this.distDir,
                                        config: browserToTerminalConfig
                                    });
                                }
                                break;
                            }
                        case 'client-file-logs':
                            {
                                // Always log to file regardless of terminal flag
                                await (0, _receivelogs.handleClientFileLogs)(payload.logs);
                                break;
                            }
                        case 'ping':
                            {
                                break;
                            }
                        default:
                            {
                                break;
                            }
                    }
                    if (traceChild) {
                        this.hotReloaderSpan.manualTraceChild(traceChild.name, traceChild.startTime, traceChild.endTime, {
                            ...traceChild.attrs,
                            clientId: payload.id
                        });
                    }
                } catch (_) {
                // invalid WebSocket message
                }
            });
            if (htmlRequestId) {
                (0, _debugchannel.connectReactDebugChannelForHtmlRequest)(htmlRequestId, this.sendToClient.bind(this, client));
                (0, _serializederrors.sendSerializedErrorsToClientForHtmlRequest)(htmlRequestId, this.sendToClient.bind(this, client));
                if (enableCacheComponents) {
                    const status = this.cacheStatusesByRequestId.get(htmlRequestId);
                    if (status) {
                        this.sendToClient(client, {
                            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.CACHE_INDICATOR,
                            state: status
                        });
                        this.cacheStatusesByRequestId.delete(htmlRequestId);
                    }
                }
            }
            client.on('close', ()=>{
                var _this_webpackHotMiddleware;
                (_this_webpackHotMiddleware = this.webpackHotMiddleware) == null ? void 0 : _this_webpackHotMiddleware.deleteClient(client, htmlRequestId);
                if (htmlRequestId) {
                    (0, _debugchannel.deleteReactDebugChannelForHtmlRequest)(htmlRequestId);
                }
            });
        });
    }
    async clean(span) {
        return span.traceChild('clean').traceAsyncFn(()=>(0, _recursivedelete.recursiveDeleteSyncWithAsyncRetries)((0, _path.join)(this.dir, this.config.distDir), /^(cache|lock)/));
    }
    async getWebpackConfig(span) {
        const webpackConfigSpan = span.traceChild('get-webpack-config');
        const pageExtensions = this.config.pageExtensions;
        return webpackConfigSpan.traceAsyncFn(async ()=>{
            const pagePaths = !this.pagesDir ? [] : await webpackConfigSpan.traceChild('get-page-paths').traceAsyncFn(()=>Promise.all([
                    (0, _findpagefile.findPageFile)(this.pagesDir, '/_app', pageExtensions, false),
                    (0, _findpagefile.findPageFile)(this.pagesDir, '/_document', pageExtensions, false)
                ]));
            this.pagesMapping = await webpackConfigSpan.traceChild('create-pages-mapping').traceAsyncFn(()=>(0, _routediscovery.createPagesMapping)({
                    isDev: true,
                    pageExtensions: this.config.pageExtensions,
                    pagesType: _pagetypes.PAGE_TYPES.PAGES,
                    pagePaths: pagePaths.filter((i)=>typeof i === 'string'),
                    pagesDir: this.pagesDir,
                    appDir: this.appDir,
                    appDirOnly: Boolean(this.appDir && !this.pagesDir)
                }));
            const entrypoints = await webpackConfigSpan.traceChild('create-entrypoints').traceAsyncFn(()=>(0, _entries.createEntrypoints)({
                    appDir: this.appDir,
                    buildId: this.buildId,
                    config: this.config,
                    envFiles: [],
                    isDev: true,
                    pages: this.pagesMapping,
                    pagesDir: this.pagesDir,
                    previewMode: this.previewProps,
                    rootDir: this.dir,
                    pageExtensions: this.config.pageExtensions
                }));
            const commonWebpackOptions = {
                dev: true,
                buildId: this.buildId,
                encryptionKey: this.encryptionKey,
                config: this.config,
                pagesDir: this.pagesDir,
                rewrites: this.rewrites,
                originalRewrites: this.config._originalRewrites,
                originalRedirects: this.config._originalRedirects,
                runWebpackSpan: this.hotReloaderSpan,
                appDir: this.appDir,
                previewProps: this.previewProps
            };
            return webpackConfigSpan.traceChild('generate-webpack-config').traceAsyncFn(async ()=>{
                const info = await (0, _webpackconfig.loadProjectInfo)({
                    dir: this.dir,
                    config: commonWebpackOptions.config,
                    dev: true
                });
                return Promise.all([
                    // order is important here
                    (0, _webpackconfig.default)(this.dir, {
                        ...commonWebpackOptions,
                        compilerType: _constants1.COMPILER_NAMES.client,
                        entrypoints: entrypoints.client,
                        ...info
                    }),
                    (0, _webpackconfig.default)(this.dir, {
                        ...commonWebpackOptions,
                        compilerType: _constants1.COMPILER_NAMES.server,
                        entrypoints: entrypoints.server,
                        ...info
                    }),
                    (0, _webpackconfig.default)(this.dir, {
                        ...commonWebpackOptions,
                        compilerType: _constants1.COMPILER_NAMES.edgeServer,
                        entrypoints: entrypoints.edgeServer,
                        ...info
                    })
                ]);
            });
        });
    }
    async buildFallbackError() {
        if (this.fallbackWatcher) return;
        const info = await (0, _webpackconfig.loadProjectInfo)({
            dir: this.dir,
            config: this.config,
            dev: true
        });
        const fallbackConfig = await (0, _webpackconfig.default)(this.dir, {
            previewProps: this.previewProps,
            runWebpackSpan: this.hotReloaderSpan,
            dev: true,
            compilerType: _constants1.COMPILER_NAMES.client,
            config: this.config,
            buildId: this.buildId,
            encryptionKey: this.encryptionKey,
            appDir: this.appDir,
            pagesDir: this.pagesDir,
            rewrites: {
                beforeFiles: [],
                afterFiles: [],
                fallback: []
            },
            originalRewrites: {
                beforeFiles: [],
                afterFiles: [],
                fallback: []
            },
            originalRedirects: [],
            isDevFallback: true,
            entrypoints: (await (0, _entries.createEntrypoints)({
                appDir: this.appDir,
                buildId: this.buildId,
                config: this.config,
                envFiles: [],
                isDev: true,
                pages: {
                    '/_app': 'next/dist/pages/_app',
                    '/_error': 'next/dist/pages/_error'
                },
                pagesDir: this.pagesDir,
                previewMode: this.previewProps,
                rootDir: this.dir,
                pageExtensions: this.config.pageExtensions
            })).client,
            ...info
        });
        const fallbackCompiler = (0, _getwebpackbundler.default)()(fallbackConfig);
        this.fallbackWatcher = await new Promise((resolve)=>{
            let bootedFallbackCompiler = false;
            fallbackCompiler.watch(// @ts-ignore webpack supports an array of watchOptions when using a multiCompiler
            fallbackConfig.watchOptions, // Errors are handled separately
            (_err)=>{
                if (!bootedFallbackCompiler) {
                    bootedFallbackCompiler = true;
                    resolve(true);
                }
            });
        });
    }
    async tracedGetVersionInfo(span) {
        const versionInfoSpan = span.traceChild('get-version-info');
        return versionInfoSpan.traceAsyncFn(async ()=>(0, _hotreloadersharedutils.getVersionInfo)());
    }
    async start() {
        const startSpan = this.hotReloaderSpan.traceChild('start');
        startSpan.stop() // Stop immediately to create an artificial parent span
        ;
        this.versionInfo = await this.tracedGetVersionInfo(startSpan);
        const inspectorURLRaw = _inspector.url();
        if (inspectorURLRaw !== undefined) {
            const inspectorURL = new URL(inspectorURLRaw);
            let debugInfo;
            try {
                const debugInfoList = await fetch(`http://${inspectorURL.host}/json/list`).then((res)=>res.json());
                debugInfo = debugInfoList[0];
            } catch  {}
            if (debugInfo) {
                this.devtoolsFrontendUrl = debugInfo.devtoolsFrontendUrl;
            }
        }
        await this.clean(startSpan);
        // Ensure distDir exists before writing package.json
        await _fs.promises.mkdir(this.distDir, {
            recursive: true
        });
        const initialDevToolsConfig = await (0, _devtoolsconfigmiddleware.getDevToolsConfig)(this.distDir);
        const distPackageJsonPath = (0, _path.join)(this.distDir, 'package.json');
        // Ensure commonjs handling is used for files in the distDir (generally .next)
        // Files outside of the distDir can be "type": "module"
        await _fs.promises.writeFile(distPackageJsonPath, '{"type": "commonjs"}');
        this.activeWebpackConfigs = await this.getWebpackConfig(startSpan);
        for (const config of this.activeWebpackConfigs){
            const defaultEntry = config.entry;
            config.entry = async (...args)=>{
                var _this_multiCompiler;
                const outputPath = ((_this_multiCompiler = this.multiCompiler) == null ? void 0 : _this_multiCompiler.outputPath) || '';
                const entries = (0, _ondemandentryhandler.getEntries)(outputPath);
                // @ts-ignore entry is always a function
                const entrypoints = await defaultEntry(...args);
                const isClientCompilation = config.name === _constants1.COMPILER_NAMES.client;
                const isNodeServerCompilation = config.name === _constants1.COMPILER_NAMES.server;
                const isEdgeServerCompilation = config.name === _constants1.COMPILER_NAMES.edgeServer;
                await Promise.all(Object.keys(entries).map(async (entryKey)=>{
                    const entryData = entries[entryKey];
                    const { bundlePath, dispose } = entryData;
                    const result = /^(client|server|edge-server)@(app|pages|root)@(.*)/g.exec(entryKey);
                    const [, key /* pageType */ , , page] = result// this match should always happen
                    ;
                    if (key === _constants1.COMPILER_NAMES.client && !isClientCompilation) return;
                    if (key === _constants1.COMPILER_NAMES.server && !isNodeServerCompilation) return;
                    if (key === _constants1.COMPILER_NAMES.edgeServer && !isEdgeServerCompilation) return;
                    const isEntry = entryData.type === _ondemandentryhandler.EntryTypes.ENTRY;
                    const isChildEntry = entryData.type === _ondemandentryhandler.EntryTypes.CHILD_ENTRY;
                    // Check if the page was removed or disposed and remove it
                    if (isEntry) {
                        const pageExists = !dispose && (0, _fs.existsSync)(entryData.absolutePagePath);
                        if (!pageExists) {
                            delete entries[entryKey];
                            return;
                        }
                    }
                    // For child entries, if it has an entry file and it's gone, remove it
                    if (isChildEntry) {
                        if (entryData.absoluteEntryFilePath) {
                            const pageExists = !dispose && (0, _fs.existsSync)(entryData.absoluteEntryFilePath);
                            if (!pageExists) {
                                delete entries[entryKey];
                                return;
                            }
                        }
                    }
                    // Ensure _error is considered a `pages` page.
                    if (page === '/_error') {
                        this.hasPagesRouterEntrypoints = true;
                    }
                    const hasAppDir = !!this.appDir;
                    const isAppPath = hasAppDir && bundlePath.startsWith('app/');
                    const staticInfo = isEntry ? await (0, _getstaticinfoincludinglayouts.getStaticInfoIncludingLayouts)({
                        isInsideAppDir: isAppPath,
                        pageExtensions: this.config.pageExtensions,
                        pageFilePath: entryData.absolutePagePath,
                        appDir: this.appDir,
                        config: this.config,
                        isDev: true,
                        page
                    }) : undefined;
                    const isServerComponent = isAppPath && (staticInfo == null ? void 0 : staticInfo.rsc) !== _constants1.RSC_MODULE_TYPES.client;
                    const pageType = entryData.bundlePath.startsWith('pages/') ? _pagetypes.PAGE_TYPES.PAGES : entryData.bundlePath.startsWith('app/') ? _pagetypes.PAGE_TYPES.APP : _pagetypes.PAGE_TYPES.ROOT;
                    if (pageType === 'pages') {
                        this.hasPagesRouterEntrypoints = true;
                    }
                    if (pageType === 'app') {
                        this.hasAppRouterEntrypoints = true;
                    }
                    const isInstrumentation = (0, _utils.isInstrumentationHookFile)(page) && pageType === _pagetypes.PAGE_TYPES.ROOT;
                    let pageRuntime = staticInfo == null ? void 0 : staticInfo.runtime;
                    (0, _entries.runDependingOnPageType)({
                        page,
                        pageRuntime,
                        pageType,
                        onEdgeServer: ()=>{
                            // TODO-APP: verify if child entry should support.
                            if (!isEdgeServerCompilation || !isEntry) return;
                            entries[entryKey].status = _ondemandentryhandler.BUILDING;
                            if (isInstrumentation) {
                                const normalizedBundlePath = bundlePath.replace('src/', '');
                                entrypoints[normalizedBundlePath] = (0, _entries.finalizeEntrypoint)({
                                    compilerType: _constants1.COMPILER_NAMES.edgeServer,
                                    name: normalizedBundlePath,
                                    value: (0, _entries.getInstrumentationEntry)({
                                        absolutePagePath: entryData.absolutePagePath,
                                        isEdgeServer: true,
                                        isDev: true
                                    }),
                                    isServerComponent: true,
                                    hasAppDir
                                });
                                return;
                            }
                            const appDirLoader = isAppPath ? (0, _entries.getAppEntry)({
                                name: bundlePath,
                                page,
                                appPaths: entryData.appPaths,
                                allNormalizedAppPaths: null,
                                pagePath: _path.posix.join(_constants.APP_DIR_ALIAS, (0, _path.relative)(this.appDir, entryData.absolutePagePath).replace(/\\/g, '/')),
                                appDir: this.appDir,
                                pageExtensions: this.config.pageExtensions,
                                rootDir: this.dir,
                                isDev: true,
                                tsconfigPath: this.config.typescript.tsconfigPath,
                                basePath: this.config.basePath,
                                assetPrefix: this.config.assetPrefix,
                                nextConfigOutput: this.config.output,
                                preferredRegion: staticInfo == null ? void 0 : staticInfo.preferredRegion,
                                middlewareConfig: Buffer.from(JSON.stringify((staticInfo == null ? void 0 : staticInfo.middleware) || {})).toString('base64'),
                                isGlobalNotFoundEnabled: this.config.experimental.globalNotFound ? true : undefined
                            }).import : undefined;
                            entrypoints[bundlePath] = (0, _entries.finalizeEntrypoint)({
                                compilerType: _constants1.COMPILER_NAMES.edgeServer,
                                name: bundlePath,
                                value: (0, _entries.getEdgeServerEntry)({
                                    absolutePagePath: entryData.absolutePagePath,
                                    rootDir: this.dir,
                                    buildId: this.buildId,
                                    bundlePath,
                                    config: this.config,
                                    isDev: true,
                                    page,
                                    pages: this.pagesMapping,
                                    isServerComponent,
                                    appDirLoader,
                                    pagesType: isAppPath ? _pagetypes.PAGE_TYPES.APP : _pagetypes.PAGE_TYPES.PAGES,
                                    preferredRegion: staticInfo == null ? void 0 : staticInfo.preferredRegion
                                }),
                                hasAppDir
                            });
                        },
                        onClient: ()=>{
                            if (!isClientCompilation) return;
                            if (isChildEntry) {
                                entries[entryKey].status = _ondemandentryhandler.BUILDING;
                                entrypoints[bundlePath] = (0, _entries.finalizeEntrypoint)({
                                    name: bundlePath,
                                    compilerType: _constants1.COMPILER_NAMES.client,
                                    value: entryData.request,
                                    hasAppDir
                                });
                            } else {
                                entries[entryKey].status = _ondemandentryhandler.BUILDING;
                                entrypoints[bundlePath] = (0, _entries.finalizeEntrypoint)({
                                    name: bundlePath,
                                    compilerType: _constants1.COMPILER_NAMES.client,
                                    value: (0, _entries.getClientEntry)({
                                        absolutePagePath: entryData.absolutePagePath,
                                        page
                                    }),
                                    hasAppDir
                                });
                            }
                        },
                        onServer: ()=>{
                            // TODO-APP: verify if child entry should support.
                            if (!isNodeServerCompilation || !isEntry) return;
                            entries[entryKey].status = _ondemandentryhandler.BUILDING;
                            let relativeRequest = (0, _path.relative)(config.context, entryData.absolutePagePath);
                            if (!(0, _path.isAbsolute)(relativeRequest) && !relativeRequest.startsWith('../')) {
                                relativeRequest = `./${relativeRequest}`;
                            }
                            let value;
                            if (isInstrumentation) {
                                value = (0, _entries.getInstrumentationEntry)({
                                    absolutePagePath: entryData.absolutePagePath,
                                    isEdgeServer: false,
                                    isDev: true
                                });
                                entrypoints[bundlePath] = (0, _entries.finalizeEntrypoint)({
                                    compilerType: _constants1.COMPILER_NAMES.server,
                                    name: bundlePath,
                                    isServerComponent: true,
                                    value,
                                    hasAppDir
                                });
                            } else if ((0, _utils.isMiddlewareFile)(page)) {
                                value = (0, _entries.getEdgeServerEntry)({
                                    absolutePagePath: entryData.absolutePagePath,
                                    rootDir: this.dir,
                                    buildId: this.buildId,
                                    bundlePath,
                                    config: this.config,
                                    isDev: true,
                                    page,
                                    pages: this.pagesMapping,
                                    isServerComponent,
                                    pagesType: _pagetypes.PAGE_TYPES.PAGES,
                                    preferredRegion: staticInfo == null ? void 0 : staticInfo.preferredRegion
                                });
                            } else if (isAppPath) {
                                // This path normalization is critical for webpack to resolve the next internals as entry.
                                const pagePath = entryData.absolutePagePath.startsWith((0, _path.dirname)(require.resolve('next/package.json'))) ? entryData.absolutePagePath : _path.posix.join(_constants.APP_DIR_ALIAS, (0, _path.relative)(this.appDir, entryData.absolutePagePath).replace(/\\/g, '/'));
                                value = (0, _entries.getAppEntry)({
                                    name: bundlePath,
                                    page,
                                    appPaths: entryData.appPaths,
                                    allNormalizedAppPaths: null,
                                    pagePath,
                                    appDir: this.appDir,
                                    pageExtensions: this.config.pageExtensions,
                                    rootDir: this.dir,
                                    isDev: true,
                                    tsconfigPath: this.config.typescript.tsconfigPath,
                                    basePath: this.config.basePath,
                                    assetPrefix: this.config.assetPrefix,
                                    nextConfigOutput: this.config.output,
                                    preferredRegion: staticInfo == null ? void 0 : staticInfo.preferredRegion,
                                    middlewareConfig: Buffer.from(JSON.stringify((staticInfo == null ? void 0 : staticInfo.middleware) || {})).toString('base64'),
                                    isGlobalNotFoundEnabled: this.config.experimental.globalNotFound ? true : undefined
                                });
                            } else if ((0, _isapiroute.isAPIRoute)(page)) {
                                value = (0, _nextrouteloader.getRouteLoaderEntry)({
                                    kind: _routekind.RouteKind.PAGES_API,
                                    page,
                                    absolutePagePath: relativeRequest,
                                    preferredRegion: staticInfo == null ? void 0 : staticInfo.preferredRegion,
                                    middlewareConfig: (staticInfo == null ? void 0 : staticInfo.middleware) || {}
                                });
                            } else if (!(0, _utils.isMiddlewareFile)(page) && !(0, _isinternalcomponent.isInternalComponent)(relativeRequest) && !(0, _isinternalcomponent.isNonRoutePagesPage)(page) && !isInstrumentation) {
                                value = (0, _nextrouteloader.getRouteLoaderEntry)({
                                    kind: _routekind.RouteKind.PAGES,
                                    page,
                                    pages: this.pagesMapping,
                                    absolutePagePath: relativeRequest,
                                    preferredRegion: staticInfo == null ? void 0 : staticInfo.preferredRegion,
                                    middlewareConfig: (staticInfo == null ? void 0 : staticInfo.middleware) ?? {}
                                });
                            } else {
                                value = relativeRequest;
                            }
                            entrypoints[bundlePath] = (0, _entries.finalizeEntrypoint)({
                                compilerType: _constants1.COMPILER_NAMES.server,
                                name: bundlePath,
                                isServerComponent,
                                value,
                                hasAppDir
                            });
                        }
                    });
                }));
                if (!this.hasPagesRouterEntrypoints) {
                    delete entrypoints[_constants1.CLIENT_STATIC_FILES_RUNTIME_MAIN];
                    delete entrypoints['pages/_app'];
                    delete entrypoints['pages/_error'];
                    delete entrypoints['/_error'];
                    delete entrypoints['pages/_document'];
                }
                // Remove React Refresh entrypoint chunk as `app` doesn't require it.
                if (!this.hasPagesRouterEntrypoints) {
                    delete entrypoints[_constants1.CLIENT_STATIC_FILES_RUNTIME_REACT_REFRESH];
                }
                if (!this.hasAppRouterEntrypoints) {
                    delete entrypoints[_constants1.CLIENT_STATIC_FILES_RUNTIME_MAIN_APP];
                }
                return entrypoints;
            };
        }
        // Enable building of client compilation before server compilation in development
        // @ts-ignore webpack 5
        this.activeWebpackConfigs.parallelism = 1;
        await Promise.all(Array.from((0, _webpackconfig.getCacheDirectories)(this.activeWebpackConfigs)).map(_cacheinvalidation.checkFileSystemCacheInvalidationAndCleanup));
        this.multiCompiler = (0, _getwebpackbundler.default)()(this.activeWebpackConfigs);
        await this.afterCompile(this.multiCompiler);
        // Copy over the filesystem so that it is shared between all compilers.
        const inputFileSystem = this.multiCompiler.compilers[0].inputFileSystem;
        for (const compiler of this.multiCompiler.compilers){
            compiler.inputFileSystem = inputFileSystem;
            // This is set for the initial compile. After that Watching class in webpack adds it.
            compiler.fsStartTime = Date.now();
            // Ensure NodeEnvironmentPlugin doesn't purge the inputFileSystem. Purging is handled in `done` below.
            compiler.hooks.beforeRun.intercept({
                register (tapInfo) {
                    if (tapInfo.name === 'NodeEnvironmentPlugin') {
                        return null;
                    }
                    return tapInfo;
                }
            });
        }
        this.multiCompiler.hooks.done.tap('NextjsHotReloader', ()=>{
            var _inputFileSystem_purge;
            inputFileSystem == null ? void 0 : (_inputFileSystem_purge = inputFileSystem.purge) == null ? void 0 : _inputFileSystem_purge.call(inputFileSystem);
        });
        (0, _output.watchCompilers)(this.multiCompiler.compilers[0], this.multiCompiler.compilers[1], this.multiCompiler.compilers[2]);
        // Watch for changes to client/server page files so we can tell when just
        // the server file changes and trigger a reload for GS(S)P pages
        const changedClientPages = new Set();
        const changedServerPages = new Set();
        const changedEdgeServerPages = new Set();
        const changedServerComponentPages = new Set();
        const changedCSSImportPages = new Set();
        const prevClientPageHashes = new Map();
        const prevServerPageHashes = new Map();
        const prevEdgeServerPageHashes = new Map();
        const prevCSSImportModuleHashes = new Map();
        const pageExtensionRegex = new RegExp(`\\.(?:${this.config.pageExtensions.join('|')})$`);
        const trackPageChanges = (pageHashMap, changedItems, serverComponentChangedItems)=>(stats)=>{
                try {
                    stats.entrypoints.forEach((entry, key)=>{
                        if (key.startsWith('pages/') || key.startsWith('app/') || (0, _utils.isMiddlewareFilename)(key)) {
                            // TODO this doesn't handle on demand loaded chunks
                            entry.chunks.forEach((chunk)=>{
                                if (chunk.id === key) {
                                    const modsIterable = stats.chunkGraph.getChunkModulesIterable(chunk);
                                    let hasCSSModuleChanges = false;
                                    let chunksHash = new _webpack.StringXor();
                                    let chunksHashServerLayer = new _webpack.StringXor();
                                    modsIterable.forEach((mod)=>{
                                        if (mod.resource && mod.resource.replace(/\\/g, '/').includes(key) && // Shouldn't match CSS modules, etc.
                                        pageExtensionRegex.test(mod.resource)) {
                                            var _mod_buildInfo_rsc, _mod_buildInfo;
                                            // use original source to calculate hash since mod.hash
                                            // includes the source map in development which changes
                                            // every time for both server and client so we calculate
                                            // the hash without the source map for the page module
                                            const hash = require('crypto').createHash('sha1').update(mod.originalSource().buffer()).digest().toString('hex');
                                            if (mod.layer === _constants.WEBPACK_LAYERS.reactServerComponents && (mod == null ? void 0 : (_mod_buildInfo = mod.buildInfo) == null ? void 0 : (_mod_buildInfo_rsc = _mod_buildInfo.rsc) == null ? void 0 : _mod_buildInfo_rsc.type) !== 'client') {
                                                chunksHashServerLayer.add(hash);
                                            }
                                            chunksHash.add(hash);
                                        } else {
                                            var _mod_buildInfo_rsc1, _mod_buildInfo1;
                                            // for non-pages we can use the module hash directly
                                            const hash = stats.chunkGraph.getModuleHash(mod, chunk.runtime);
                                            if (mod.layer === _constants.WEBPACK_LAYERS.reactServerComponents && (mod == null ? void 0 : (_mod_buildInfo1 = mod.buildInfo) == null ? void 0 : (_mod_buildInfo_rsc1 = _mod_buildInfo1.rsc) == null ? void 0 : _mod_buildInfo_rsc1.type) !== 'client') {
                                                chunksHashServerLayer.add(hash);
                                            }
                                            chunksHash.add(hash);
                                            // Both CSS import changes from server and client
                                            // components are tracked.
                                            if (key.startsWith('app/') && /\.(css|scss|sass)$/.test(mod.resource || '')) {
                                                const resourceKey = mod.layer + ':' + mod.resource;
                                                const prevHash = prevCSSImportModuleHashes.get(resourceKey);
                                                if (prevHash && prevHash !== hash) {
                                                    hasCSSModuleChanges = true;
                                                }
                                                prevCSSImportModuleHashes.set(resourceKey, hash);
                                            }
                                        }
                                    });
                                    const prevHash = pageHashMap.get(key);
                                    const curHash = chunksHash.toString();
                                    if (prevHash && prevHash !== curHash) {
                                        changedItems.add(key);
                                    }
                                    pageHashMap.set(key, curHash);
                                    if (serverComponentChangedItems) {
                                        const serverKey = _constants.WEBPACK_LAYERS.reactServerComponents + ':' + key;
                                        const prevServerHash = pageHashMap.get(serverKey);
                                        const curServerHash = chunksHashServerLayer.toString();
                                        if (prevServerHash && prevServerHash !== curServerHash) {
                                            serverComponentChangedItems.add(key);
                                        }
                                        pageHashMap.set(serverKey, curServerHash);
                                    }
                                    if (hasCSSModuleChanges) {
                                        changedCSSImportPages.add(key);
                                    }
                                }
                            });
                        }
                    });
                } catch (err) {
                    console.error(err);
                }
            };
        this.multiCompiler.compilers[0].hooks.emit.tap('NextjsHotReloaderForClient', trackPageChanges(prevClientPageHashes, changedClientPages));
        this.multiCompiler.compilers[1].hooks.emit.tap('NextjsHotReloaderForServer', trackPageChanges(prevServerPageHashes, changedServerPages, changedServerComponentPages));
        this.multiCompiler.compilers[2].hooks.emit.tap('NextjsHotReloaderForServer', trackPageChanges(prevEdgeServerPageHashes, changedEdgeServerPages, changedServerComponentPages));
        // This plugin watches for changes to _document.js and notifies the client side that it should reload the page
        this.multiCompiler.compilers[1].hooks.failed.tap('NextjsHotReloaderForServer', (err)=>{
            this.serverError = err;
            this.serverStats = null;
            this.serverChunkNames = undefined;
        });
        this.multiCompiler.compilers[2].hooks.done.tap('NextjsHotReloaderForServer', (stats)=>{
            this.serverError = null;
            this.edgeServerStats = stats;
        });
        this.multiCompiler.compilers[1].hooks.done.tap('NextjsHotReloaderForServer', (stats)=>{
            this.serverError = null;
            this.serverStats = stats;
            if (!this.pagesDir) {
                return;
            }
            const { compilation } = stats;
            // We only watch `_document` for changes on the server compilation
            // the rest of the files will be triggered by the client compilation
            const documentChunk = compilation.namedChunks.get('pages/_document');
            // If the document chunk can't be found we do nothing
            if (!documentChunk) {
                return;
            }
            // Initial value
            if (this.serverPrevDocumentHash === null) {
                this.serverPrevDocumentHash = documentChunk.hash || null;
                return;
            }
            // If _document.js didn't change we don't trigger a reload.
            if (documentChunk.hash === this.serverPrevDocumentHash) {
                return;
            }
            // As document chunk will change if new app pages are joined,
            // since react bundle is different it will effect the chunk hash.
            // So we diff the chunk changes, if there's only new app page chunk joins,
            // then we don't trigger a reload by checking pages/_document chunk change.
            if (this.appDir) {
                const chunkNames = new Set(compilation.namedChunks.keys());
                const diffChunkNames = (0, _utils.difference)(this.serverChunkNames || new Set(), chunkNames);
                if (diffChunkNames.length === 0 || diffChunkNames.every((chunkName)=>chunkName.startsWith('app/'))) {
                    return;
                }
                this.serverChunkNames = chunkNames;
            }
            this.serverPrevDocumentHash = documentChunk.hash || null;
            // Notify reload to reload the page, as _document.js was changed (different hash)
            this.send({
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                data: '_document has changed'
            });
        });
        this.multiCompiler.hooks.done.tap('NextjsHotReloaderForServer', (stats)=>{
            const reloadAfterInvalidation = this.reloadAfterInvalidation;
            this.reloadAfterInvalidation = false;
            const serverOnlyChanges = (0, _utils.difference)(changedServerPages, changedClientPages);
            const edgeServerOnlyChanges = (0, _utils.difference)(changedEdgeServerPages, changedClientPages);
            const pageChanges = serverOnlyChanges.concat(edgeServerOnlyChanges).filter((key)=>key.startsWith('pages/'));
            const middlewareChanges = [
                ...Array.from(changedEdgeServerPages),
                ...Array.from(changedServerPages)
            ].filter((name)=>(0, _utils.isMiddlewareFilename)(name));
            if (middlewareChanges.length > 0) {
                this.send({
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.MIDDLEWARE_CHANGES
                });
            }
            if (pageChanges.length > 0) {
                this.send({
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_ONLY_CHANGES,
                    pages: serverOnlyChanges.map((pg)=>(0, _denormalizepagepath.denormalizePagePath)(pg.slice('pages'.length)))
                });
            }
            if (changedServerComponentPages.size || changedCSSImportPages.size || reloadAfterInvalidation) {
                this.resetFetch();
                this.refreshServerComponents(stats.hash);
            }
            changedClientPages.clear();
            changedServerPages.clear();
            changedEdgeServerPages.clear();
            changedServerComponentPages.clear();
            changedCSSImportPages.clear();
        });
        this.multiCompiler.compilers[0].hooks.failed.tap('NextjsHotReloaderForClient', (err)=>{
            this.clientError = err;
            this.clientStats = null;
        });
        this.multiCompiler.compilers[0].hooks.done.tap('NextjsHotReloaderForClient', (stats)=>{
            this.clientError = null;
            this.clientStats = stats;
            const { compilation } = stats;
            const chunkNames = new Set([
                ...compilation.namedChunks.keys()
            ].filter((name)=>!!(0, _getroutefromentrypoint.default)(name)));
            if (this.prevChunkNames) {
                // detect chunks which have to be replaced with a new template
                // e.g, pages/index.js <-> pages/_error.js
                const addedPages = diff(chunkNames, this.prevChunkNames);
                const removedPages = diff(this.prevChunkNames, chunkNames);
                if (addedPages.size > 0) {
                    for (const addedPage of addedPages){
                        const page = (0, _getroutefromentrypoint.default)(addedPage);
                        this.send({
                            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ADDED_PAGE,
                            data: [
                                page
                            ]
                        });
                    }
                }
                if (removedPages.size > 0) {
                    for (const removedPage of removedPages){
                        const page = (0, _getroutefromentrypoint.default)(removedPage);
                        this.send({
                            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REMOVED_PAGE,
                            data: [
                                page
                            ]
                        });
                    }
                }
            }
            this.prevChunkNames = chunkNames;
        });
        this.webpackHotMiddleware = new _hotmiddleware.WebpackHotMiddleware(this.multiCompiler.compilers, this.versionInfo, this.devtoolsFrontendUrl, this.config, initialDevToolsConfig);
        let booted = false;
        this.watcher = await new Promise((resolve)=>{
            var _this_multiCompiler;
            const watcher = (_this_multiCompiler = this.multiCompiler) == null ? void 0 : _this_multiCompiler.watch(// @ts-ignore webpack supports an array of watchOptions when using a multiCompiler
            this.activeWebpackConfigs.map((config)=>config.watchOptions), // Errors are handled separately
            (_err)=>{
                if (!booted) {
                    booted = true;
                    resolve(watcher);
                }
            });
        });
        this.onDemandEntries = (0, _ondemandentryhandler.onDemandEntryHandler)({
            hotReloader: this,
            multiCompiler: this.multiCompiler,
            pagesDir: this.pagesDir,
            appDir: this.appDir,
            rootDir: this.dir,
            nextConfig: this.config,
            ...this.config.onDemandEntries
        });
        this.middlewares.push((0, _middlewarewebpack.getOverlayMiddleware)({
            rootDirectory: this.dir,
            isSrcDir: this.isSrcDir,
            clientStats: ()=>this.clientStats,
            serverStats: ()=>this.serverStats,
            edgeServerStats: ()=>this.edgeServerStats
        }), (0, _middlewarewebpack.getSourceMapMiddleware)({
            clientStats: ()=>this.clientStats,
            serverStats: ()=>this.serverStats,
            edgeServerStats: ()=>this.edgeServerStats
        }), (0, _getnexterrorfeedbackmiddleware.getNextErrorFeedbackMiddleware)(this.telemetry), (0, _getdevoverlayfontmiddleware.getDevOverlayFontMiddleware)(), (0, _devindicatormiddleware.getDisableDevIndicatorMiddleware)(), (0, _restartdevservermiddleware.getRestartDevServerMiddleware)({
            telemetry: this.telemetry,
            webpackCacheDirectories: this.activeWebpackConfigs != null ? (0, _webpackconfig.getCacheDirectories)(this.activeWebpackConfigs) : undefined
        }), (0, _devtoolsconfigmiddleware.devToolsConfigMiddleware)({
            distDir: this.distDir,
            sendUpdateSignal: (data)=>{
                var // Update the in-memory devToolsConfig value
                // which will be used for the next onHMR call.
                _this_webpackHotMiddleware;
                (_this_webpackHotMiddleware = this.webpackHotMiddleware) == null ? void 0 : _this_webpackHotMiddleware.updateDevToolsConfig(data);
                this.send({
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.DEVTOOLS_CONFIG,
                    data
                });
            }
        }), (0, _attachnodejsdebuggermiddleware.getAttachNodejsDebuggerMiddleware)(), ...this.config.experimental.mcpServer ? [
            (0, _getmcpmiddleware.getMcpMiddleware)({
                projectPath: this.dir,
                distDir: this.distDir,
                nextConfig: this.config,
                pagesDir: this.pagesDir,
                appDir: this.appDir,
                sendHmrMessage: (message)=>this.send(message),
                getActiveConnectionCount: ()=>{
                    var _this_webpackHotMiddleware;
                    return ((_this_webpackHotMiddleware = this.webpackHotMiddleware) == null ? void 0 : _this_webpackHotMiddleware.getClientCount()) ?? 0;
                },
                getDevServerUrl: ()=>process.env.__NEXT_PRIVATE_ORIGIN
            })
        ] : []);
        (0, _formaterrors.setStackFrameResolver)(async (request)=>{
            return (0, _middlewarewebpack.getOriginalStackFrames)({
                isServer: request.isServer,
                isEdgeServer: request.isEdgeServer,
                isAppDirectory: request.isAppDirectory,
                frames: request.frames,
                clientStats: ()=>this.clientStats,
                serverStats: ()=>this.serverStats,
                edgeServerStats: ()=>this.edgeServerStats,
                rootDirectory: this.dir
            });
        });
    }
    async afterCompile(_multiCompiler) {}
    invalidate({ reloadAfterInvalidation } = {
        reloadAfterInvalidation: false
    }) {
        var _this_multiCompiler;
        // Cache the `reloadAfterInvalidation` flag, and use it to reload the page when compilation is done
        this.reloadAfterInvalidation = reloadAfterInvalidation;
        const outputPath = (_this_multiCompiler = this.multiCompiler) == null ? void 0 : _this_multiCompiler.outputPath;
        if (outputPath) {
            var _getInvalidator;
            (_getInvalidator = (0, _ondemandentryhandler.getInvalidator)(outputPath)) == null ? void 0 : _getInvalidator.invalidate();
        }
    }
    async getCompilationErrors(page) {
        var _this_clientStats, _this_serverStats, _this_edgeServerStats;
        const getErrors = ({ compilation })=>{
            var _failedPages_normalizedPage;
            const failedPages = erroredPages(compilation);
            const normalizedPage = (0, _normalizepathsep.normalizePathSep)(page);
            // If there is an error related to the requesting page we display it instead of the first error
            return ((_failedPages_normalizedPage = failedPages[normalizedPage]) == null ? void 0 : _failedPages_normalizedPage.length) > 0 ? failedPages[normalizedPage] : compilation.errors;
        };
        if (this.clientError) {
            return [
                this.clientError
            ];
        } else if (this.serverError) {
            return [
                this.serverError
            ];
        } else if ((_this_clientStats = this.clientStats) == null ? void 0 : _this_clientStats.hasErrors()) {
            return getErrors(this.clientStats);
        } else if ((_this_serverStats = this.serverStats) == null ? void 0 : _this_serverStats.hasErrors()) {
            return getErrors(this.serverStats);
        } else if ((_this_edgeServerStats = this.edgeServerStats) == null ? void 0 : _this_edgeServerStats.hasErrors()) {
            return getErrors(this.edgeServerStats);
        } else {
            return [];
        }
    }
    send(message) {
        this.webpackHotMiddleware.publish(message);
    }
    sendToClient(client, message) {
        this.webpackHotMiddleware.publishToClient(client, message);
    }
    sendToLegacyClients(message) {
        this.webpackHotMiddleware.publishToLegacyClients(message);
    }
    setCacheStatus(status, htmlRequestId) {
        var _this_webpackHotMiddleware;
        const client = (_this_webpackHotMiddleware = this.webpackHotMiddleware) == null ? void 0 : _this_webpackHotMiddleware.getClient(htmlRequestId);
        if (client !== undefined) {
            this.sendToClient(client, {
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.CACHE_INDICATOR,
                state: status
            });
        } else {
            // If the client is not connected, store the status so that we can send it
            // when the client connects.
            this.cacheStatusesByRequestId.set(htmlRequestId, status);
        }
    }
    setReactDebugChannel(debugChannel, htmlRequestId, requestId) {
        var _this_webpackHotMiddleware;
        const client = (_this_webpackHotMiddleware = this.webpackHotMiddleware) == null ? void 0 : _this_webpackHotMiddleware.getClient(htmlRequestId);
        if (htmlRequestId === requestId) {
            // The debug channel is for the HTML request.
            if (client) {
                // If the client is connected, we can connect the debug channel for
                // the HTML request immediately.
                (0, _debugchannel.connectReactDebugChannel)(htmlRequestId, debugChannel, this.sendToClient.bind(this, client));
            } else {
                // Otherwise, we'll do that when the client connects and just store
                // the debug channel.
                (0, _debugchannel.setReactDebugChannelForHtmlRequest)(htmlRequestId, debugChannel);
            }
        } else if (client) {
            // The debug channel is for a subsequent request (e.g. client-side
            // navigation for server function call). If the client is not connected
            // anymore, we don't need to connect the debug channel.
            (0, _debugchannel.connectReactDebugChannel)(requestId, debugChannel, this.sendToClient.bind(this, client));
        }
    }
    sendErrorsToBrowser(errorsRscStream, htmlRequestId) {
        var _this_webpackHotMiddleware;
        const client = (_this_webpackHotMiddleware = this.webpackHotMiddleware) == null ? void 0 : _this_webpackHotMiddleware.getClient(htmlRequestId);
        if (client) {
            // If the client is connected, we can send the errors immediately.
            (0, _serializederrors.sendSerializedErrorsToClient)(errorsRscStream, this.sendToClient.bind(this, client));
        } else {
            // Otherwise, store the errors stream so that we can send it when the
            // client connects.
            (0, _serializederrors.setErrorsRscStreamForHtmlRequest)(htmlRequestId, errorsRscStream);
        }
    }
    async ensurePage({ page, clientOnly, appPaths, definition, isApp, url }) {
        return this.hotReloaderSpan.traceChild('ensure-page', {
            inputPage: page
        }).traceAsyncFn(async ()=>{
            var _this_onDemandEntries;
            // Make sure we don't re-build or dispose prebuilt pages
            if (page !== '/_error' && _constants1.BLOCKED_PAGES.indexOf(page) !== -1) {
                return;
            }
            const error = clientOnly ? this.clientError : this.serverError || this.clientError;
            if (error) {
                throw error;
            }
            return (_this_onDemandEntries = this.onDemandEntries) == null ? void 0 : _this_onDemandEntries.ensurePage({
                page,
                appPaths,
                definition,
                isApp,
                url
            });
        });
    }
    close() {
        var _this_webpackHotMiddleware;
        // Report MCP telemetry if MCP server is enabled
        (0, _mcptelemetrytracker.recordMcpTelemetry)(this.telemetry);
        (_this_webpackHotMiddleware = this.webpackHotMiddleware) == null ? void 0 : _this_webpackHotMiddleware.close();
    }
}

//# sourceMappingURL=hot-reloader-webpack.js.map