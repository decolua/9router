// this must come first as it includes require hooks
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "initialize", {
    enumerable: true,
    get: function() {
        return initialize;
    }
});
require("../node-environment");
require("../require-hook");
const _url = /*#__PURE__*/ _interop_require_default(require("url"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _config = /*#__PURE__*/ _interop_require_default(require("../config"));
const _servestatic = require("../serve-static");
const _debug = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/debug"));
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../build/output/log"));
const _utils = require("../../shared/lib/utils");
const _findpagesdir = require("../../lib/find-pages-dir");
const _filesystem = require("./router-utils/filesystem");
const _proxyrequest = require("./router-utils/proxy-request");
const _pipereadable = require("../pipe-readable");
const _resolveroutes = require("./router-utils/resolve-routes");
const _requestmeta = require("../request-meta");
const _pathhasprefix = require("../../shared/lib/router/utils/path-has-prefix");
const _removepathprefix = require("../../shared/lib/router/utils/remove-path-prefix");
const _compression = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/compression"));
const _nextrequest = require("../web/spec-extension/adapters/next-request");
const _ispostpone = require("./router-utils/is-postpone");
const _parseurl = require("../../shared/lib/router/utils/parse-url");
const _constants = require("../../shared/lib/constants");
const _redirectstatuscode = require("../../client/components/redirect-status-code");
const _devbundlerservice = require("./dev-bundler-service");
const _trace = require("../../trace");
const _ensureleadingslash = require("../../shared/lib/page-path/ensure-leading-slash");
const _getnextpathnameinfo = require("../../shared/lib/router/utils/get-next-pathname-info");
const _gethostname = require("../../shared/lib/get-hostname");
const _detectdomainlocale = require("../../shared/lib/i18n/detect-domain-locale");
const _mockrequest = require("./mock-request");
const _hotreloadertypes = require("../dev/hot-reloader-types");
const _normalizedassetprefix = require("../../shared/lib/normalized-asset-prefix");
const _patchfetch = require("./patch-fetch");
const _utils1 = require("./server-ipc/utils");
const _blockcrosssitedev = require("./router-utils/block-cross-site-dev");
const _shared = require("../../trace/shared");
const _nofallbackerrorexternal = require("../../shared/lib/no-fallback-error.external");
const _routerservercontext = require("./router-utils/router-server-context");
const _chromedevtoolsworkspace = require("./chrome-devtools-workspace");
const _configshared = require("../config-shared");
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
const debug = (0, _debug.default)('next:router-server:main');
const isNextFont = (pathname)=>pathname && /\/media\/[^/]+\.(woff|woff2|eot|ttf|otf)$/.test(pathname);
const requestHandlers = {};
async function initialize(opts) {
    var _development_bundler, _development_service, _development_service1, _development_service2, _development_service3, _development_service4, _development_bundler1;
    if (!process.env.NODE_ENV) {
        // @ts-ignore not readonly
        process.env.NODE_ENV = opts.dev ? 'development' : 'production';
    }
    let experimentalFeatures = [];
    const config = await (0, _config.default)(opts.dev ? _constants.PHASE_DEVELOPMENT_SERVER : _constants.PHASE_PRODUCTION_SERVER, opts.dir, {
        silent: false,
        reportExperimentalFeatures (features) {
            experimentalFeatures = features.toSorted(({ key: a }, { key: b })=>a.localeCompare(b));
        }
    });
    let compress;
    if ((config == null ? void 0 : config.compress) !== false) {
        compress = (0, _compression.default)();
    }
    const fsChecker = await (0, _filesystem.setupFsCheck)({
        dev: opts.dev,
        dir: opts.dir,
        config,
        minimalMode: opts.minimalMode
    });
    const renderServer = {};
    let development = undefined;
    let originalFetch = globalThis.fetch;
    if (opts.dev) {
        const { Telemetry } = require('../../telemetry/storage');
        const telemetry = new Telemetry({
            distDir: _path.default.join(opts.dir, config.distDir)
        });
        _shared.traceGlobals.set('telemetry', telemetry);
        const { pagesDir, appDir } = (0, _findpagesdir.findPagesDir)(opts.dir);
        const { setupDevBundler } = require('./router-utils/setup-dev-bundler');
        const resetFetch = ()=>{
            globalThis.fetch = originalFetch;
            globalThis[_patchfetch.NEXT_PATCH_SYMBOL] = false;
        };
        const setupDevBundlerSpan = opts.startServerSpan ? opts.startServerSpan.traceChild('setup-dev-bundler') : (0, _trace.trace)('setup-dev-bundler');
        // In development, it's always the complete config.
        let developmentConfig = config;
        let developmentBundler = await setupDevBundlerSpan.traceAsyncFn(()=>setupDevBundler({
                // Passed here but the initialization of this object happens below, doing the initialization before the setupDev call breaks.
                renderServer,
                appDir,
                pagesDir,
                telemetry,
                fsChecker,
                dir: opts.dir,
                nextConfig: developmentConfig,
                isCustomServer: opts.customServer,
                turbo: !!process.env.TURBOPACK,
                port: opts.port,
                onDevServerCleanup: opts.onDevServerCleanup,
                resetFetch,
                serverFastRefresh: opts.serverFastRefresh
            }));
        let devBundlerService = new _devbundlerservice.DevBundlerService(developmentBundler, // The request handler is assigned below, this allows us to create a lazy
        // reference to it.
        (req, res)=>{
            return requestHandlers[opts.dir](req, res);
        });
        development = {
            bundler: developmentBundler,
            service: devBundlerService,
            config: developmentConfig
        };
    }
    renderServer.instance = require('./render-server');
    const requestHandlerImpl = async (req, res)=>{
        (0, _requestmeta.addRequestMeta)(req, 'relativeProjectDir', relativeProjectDir);
        // internal headers should not be honored by the request handler
        if (!process.env.NEXT_PRIVATE_TEST_HEADERS) {
            (0, _utils1.filterInternalHeaders)(req.headers);
        }
        if (!opts.minimalMode && config.i18n && config.i18n.localeDetection !== false) {
            var _this;
            const urlParts = (req.url || '').split('?', 1);
            let urlNoQuery = urlParts[0] || '';
            if (config.basePath) {
                urlNoQuery = (0, _removepathprefix.removePathPrefix)(urlNoQuery, config.basePath);
            }
            const pathnameInfo = (0, _getnextpathnameinfo.getNextPathnameInfo)(urlNoQuery, {
                nextConfig: config
            });
            const domainLocale = (0, _detectdomainlocale.detectDomainLocale)(config.i18n.domains, (0, _gethostname.getHostname)({
                hostname: urlNoQuery
            }, req.headers));
            const defaultLocale = (domainLocale == null ? void 0 : domainLocale.defaultLocale) || config.i18n.defaultLocale;
            const { getLocaleRedirect } = require('../../shared/lib/i18n/get-locale-redirect');
            const parsedUrl = (0, _parseurl.parseUrl)((_this = req.url || '') == null ? void 0 : _this.replace(/^\/+/, '/'));
            const redirect = getLocaleRedirect({
                defaultLocale,
                domainLocale,
                headers: req.headers,
                nextConfig: config,
                pathLocale: pathnameInfo.locale,
                urlParsed: {
                    ...parsedUrl,
                    pathname: pathnameInfo.locale ? `/${pathnameInfo.locale}${urlNoQuery}` : urlNoQuery
                }
            });
            if (redirect) {
                res.setHeader('Location', redirect);
                res.statusCode = _redirectstatuscode.RedirectStatusCode.TemporaryRedirect;
                res.end(redirect);
                return;
            }
        }
        if (compress) {
            // @ts-expect-error not express req/res
            compress(req, res, ()=>{});
        }
        req.on('error', (_err)=>{
        // TODO: log socket errors?
        });
        res.on('error', (_err)=>{
        // TODO: log socket errors?
        });
        const invokedOutputs = new Set();
        async function invokeRender(parsedUrl, invokePath, handleIndex, additionalRequestMeta) {
            var _fsChecker_getMiddlewareMatchers;
            // invokeRender expects /api routes to not be locale prefixed
            // so normalize here before continuing
            if (config.i18n && (0, _removepathprefix.removePathPrefix)(invokePath, config.basePath).startsWith(`/${(0, _requestmeta.getRequestMeta)(req, 'locale')}/api`)) {
                invokePath = fsChecker.handleLocale((0, _removepathprefix.removePathPrefix)(invokePath, config.basePath)).pathname;
            }
            if (req.headers['x-nextjs-data'] && ((_fsChecker_getMiddlewareMatchers = fsChecker.getMiddlewareMatchers()) == null ? void 0 : _fsChecker_getMiddlewareMatchers.length) && (0, _removepathprefix.removePathPrefix)(invokePath, config.basePath) === '/404') {
                res.setHeader('x-nextjs-matched-path', parsedUrl.pathname || '');
                res.statusCode = 404;
                res.setHeader('content-type', 'application/json');
                res.end('{}');
                return null;
            }
            if (!handlers) {
                throw Object.defineProperty(new Error('Failed to initialize render server'), "__NEXT_ERROR_CODE", {
                    value: "E90",
                    enumerable: false,
                    configurable: true
                });
            }
            (0, _requestmeta.addRequestMeta)(req, 'invokePath', invokePath);
            (0, _requestmeta.addRequestMeta)(req, 'invokeQuery', parsedUrl.query);
            (0, _requestmeta.addRequestMeta)(req, 'middlewareInvoke', false);
            for(const key in additionalRequestMeta || {}){
                (0, _requestmeta.addRequestMeta)(req, key, additionalRequestMeta[key]);
            }
            debug('invokeRender', req.url, req.headers);
            try {
                var _renderServer_instance;
                const initResult = await (renderServer == null ? void 0 : (_renderServer_instance = renderServer.instance) == null ? void 0 : _renderServer_instance.initialize(renderServerOpts));
                try {
                    await (initResult == null ? void 0 : initResult.requestHandler(req, res));
                } catch (err) {
                    if (err instanceof _nofallbackerrorexternal.NoFallbackError) {
                        await handleRequest(handleIndex + 1);
                        return;
                    }
                    throw err;
                }
                return;
            } catch (e) {
                // If the client aborts before we can receive a response object (when
                // the headers are flushed), then we can early exit without further
                // processing.
                if ((0, _pipereadable.isAbortError)(e)) {
                    return;
                }
                throw e;
            }
        }
        const handleRequest = async (handleIndex)=>{
            var _development_bundler;
            if (handleIndex > 5) {
                throw Object.defineProperty(new Error(`Attempted to handle request too many times ${req.url}`), "__NEXT_ERROR_CODE", {
                    value: "E283",
                    enumerable: false,
                    configurable: true
                });
            }
            // handle hot-reloader first
            if (development) {
                if ((0, _blockcrosssitedev.blockCrossSiteDEV)(req, res, development.config.allowedDevOrigins, opts.hostname)) {
                    return;
                }
                const origUrl = req.url || '/';
                // both the basePath and assetPrefix need to be stripped from the URL
                // so that the development bundler can find the correct file
                if (config.basePath && (0, _pathhasprefix.pathHasPrefix)(origUrl, config.basePath)) {
                    req.url = (0, _removepathprefix.removePathPrefix)(origUrl, config.basePath);
                } else if (config.assetPrefix && (0, _pathhasprefix.pathHasPrefix)(origUrl, config.assetPrefix)) {
                    req.url = (0, _removepathprefix.removePathPrefix)(origUrl, config.assetPrefix);
                }
                const parsedUrl = (0, _parseurl.parseUrl)(req.url || '/');
                const hotReloaderResult = await development.bundler.hotReloader.run(req, res, parsedUrl);
                if (hotReloaderResult.finished) {
                    return hotReloaderResult;
                }
                req.url = origUrl;
            }
            const { finished, parsedUrl, statusCode, resHeaders, bodyStream, matchedOutput } = await resolveRoutes({
                req,
                res,
                isUpgradeReq: false,
                signal: (0, _nextrequest.signalFromNodeResponse)(res),
                invokedOutputs
            });
            if (res.closed || res.finished) {
                return;
            }
            if (development && (matchedOutput == null ? void 0 : matchedOutput.type) === 'devVirtualFsItem') {
                const origUrl = req.url || '/';
                if (config.basePath && (0, _pathhasprefix.pathHasPrefix)(origUrl, config.basePath)) {
                    req.url = (0, _removepathprefix.removePathPrefix)(origUrl, config.basePath);
                } else if (config.assetPrefix && (0, _pathhasprefix.pathHasPrefix)(origUrl, config.assetPrefix)) {
                    req.url = (0, _removepathprefix.removePathPrefix)(origUrl, config.assetPrefix);
                }
                if (resHeaders !== null) {
                    for (const key of Object.keys(resHeaders)){
                        res.setHeader(key, resHeaders[key]);
                    }
                }
                const result = await development.bundler.requestHandler(req, res);
                if (result.finished) {
                    return;
                }
                // TODO: throw invariant if we resolved to this but it wasn't handled?
                req.url = origUrl;
            }
            debug('requestHandler!', req.url, {
                matchedOutput,
                statusCode,
                resHeaders,
                bodyStream: !!bodyStream,
                parsedUrl: {
                    pathname: parsedUrl.pathname,
                    query: parsedUrl.query
                },
                finished
            });
            // apply any response headers from routing
            if (resHeaders !== null) {
                for (const key of Object.keys(resHeaders)){
                    res.setHeader(key, resHeaders[key]);
                }
            }
            // handle redirect
            if (!bodyStream && statusCode && statusCode > 300 && statusCode < 400) {
                const destination = _url.default.format(parsedUrl);
                res.statusCode = statusCode;
                res.setHeader('location', destination);
                if (statusCode === _redirectstatuscode.RedirectStatusCode.PermanentRedirect) {
                    res.setHeader('Refresh', `0;url=${destination}`);
                }
                return res.end(destination);
            }
            // handle middleware body response
            if (bodyStream) {
                res.statusCode = statusCode || 200;
                return await (0, _pipereadable.pipeToNodeResponse)(bodyStream, res);
            }
            if (finished && parsedUrl.protocol) {
                var _getRequestMeta;
                return await (0, _proxyrequest.proxyRequest)(req, res, parsedUrl, undefined, (_getRequestMeta = (0, _requestmeta.getRequestMeta)(req, 'clonableBody')) == null ? void 0 : _getRequestMeta.cloneBodyStream(), config.experimental.proxyTimeout);
            }
            if ((matchedOutput == null ? void 0 : matchedOutput.fsPath) && matchedOutput.itemPath) {
                if (opts.dev && (fsChecker.appFiles.has(matchedOutput.itemPath) || fsChecker.pageFiles.has(matchedOutput.itemPath))) {
                    res.statusCode = 500;
                    const message = `A conflicting public file and page file was found for path ${matchedOutput.itemPath} https://nextjs.org/docs/messages/conflicting-public-file-page`;
                    await invokeRender(parsedUrl, '/_error', handleIndex, {
                        invokeStatus: 500,
                        invokeError: Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                            value: "E212",
                            enumerable: false,
                            configurable: true
                        })
                    });
                    _log.error(message);
                    return;
                }
                if (!res.getHeader('cache-control') && matchedOutput.type === 'nextStaticFolder') {
                    if (opts.dev && !isNextFont(parsedUrl.pathname)) {
                        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
                    } else {
                        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                    }
                }
                if (!(req.method === 'GET' || req.method === 'HEAD')) {
                    res.setHeader('Allow', [
                        'GET',
                        'HEAD'
                    ]);
                    res.statusCode = 405;
                    return await invokeRender((0, _parseurl.parseUrl)('/405'), '/405', handleIndex, {
                        invokeStatus: 405
                    });
                }
                try {
                    return await (0, _servestatic.serveStatic)(req, res, matchedOutput.itemPath, {
                        root: matchedOutput.itemsRoot,
                        // Ensures that etags are not generated for static files when disabled.
                        etag: config.generateEtags
                    });
                } catch (err) {
                    /**
           * Hardcoded every possible error status code that could be thrown by "serveStatic" method
           * This is done by searching "this.error" inside "send" module's source code:
           * https://github.com/pillarjs/send/blob/master/index.js
           * https://github.com/pillarjs/send/blob/develop/index.js
           */ const POSSIBLE_ERROR_CODE_FROM_SERVE_STATIC = new Set([
                        // send module will throw 500 when header is already sent or fs.stat error happens
                        // https://github.com/pillarjs/send/blob/53f0ab476145670a9bdd3dc722ab2fdc8d358fc6/index.js#L392
                        // Note: we will use Next.js built-in 500 page to handle 500 errors
                        // 500,
                        // send module will throw 404 when file is missing
                        // https://github.com/pillarjs/send/blob/53f0ab476145670a9bdd3dc722ab2fdc8d358fc6/index.js#L421
                        // Note: we will use Next.js built-in 404 page to handle 404 errors
                        // 404,
                        // send module will throw 403 when redirecting to a directory without enabling directory listing
                        // https://github.com/pillarjs/send/blob/53f0ab476145670a9bdd3dc722ab2fdc8d358fc6/index.js#L484
                        // Note: Next.js throws a different error (without status code) for directory listing
                        // 403,
                        // send module will throw 400 when fails to normalize the path
                        // https://github.com/pillarjs/send/blob/53f0ab476145670a9bdd3dc722ab2fdc8d358fc6/index.js#L520
                        400,
                        // send module will throw 412 with conditional GET request
                        // https://github.com/pillarjs/send/blob/53f0ab476145670a9bdd3dc722ab2fdc8d358fc6/index.js#L632
                        412,
                        // send module will throw 416 when range is not satisfiable
                        // https://github.com/pillarjs/send/blob/53f0ab476145670a9bdd3dc722ab2fdc8d358fc6/index.js#L669
                        416
                    ]);
                    let validErrorStatus = POSSIBLE_ERROR_CODE_FROM_SERVE_STATIC.has(err.statusCode);
                    // normalize non-allowed status codes
                    if (!validErrorStatus) {
                        ;
                        err.statusCode = 400;
                    }
                    if (typeof err.statusCode === 'number') {
                        const invokePath = `/${err.statusCode}`;
                        const invokeStatus = err.statusCode;
                        res.statusCode = err.statusCode;
                        return await invokeRender((0, _parseurl.parseUrl)(invokePath), invokePath, handleIndex, {
                            invokeStatus
                        });
                    }
                    throw err;
                }
            }
            if (matchedOutput) {
                invokedOutputs.add(matchedOutput.itemPath);
                return await invokeRender(parsedUrl, parsedUrl.pathname || '/', handleIndex, {
                    invokeOutput: matchedOutput.itemPath
                });
            }
            // We want the original pathname without any basePath or proxy rewrites.
            if (development && (0, _chromedevtoolsworkspace.isChromeDevtoolsWorkspaceUrl)(req.url)) {
                await (0, _chromedevtoolsworkspace.handleChromeDevtoolsWorkspaceRequest)(res, opts, config);
                return;
            }
            // 404 case
            res.setHeader('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
            let realRequestPathname = parsedUrl.pathname ?? '';
            if (realRequestPathname) {
                if (config.basePath) {
                    realRequestPathname = (0, _removepathprefix.removePathPrefix)(realRequestPathname, config.basePath);
                }
                if (config.assetPrefix) {
                    realRequestPathname = (0, _removepathprefix.removePathPrefix)(realRequestPathname, config.assetPrefix);
                }
                if (config.i18n) {
                    realRequestPathname = (0, _removepathprefix.removePathPrefix)(realRequestPathname, '/' + ((0, _requestmeta.getRequestMeta)(req, 'locale') ?? ''));
                }
            }
            // For not found static assets, return plain text 404 instead of
            // full HTML 404 pages to save bandwidth.
            if (realRequestPathname.startsWith('/_next/static/')) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.end('Not Found');
                return null;
            }
            // Short-circuit favicon.ico serving so that the 404 page doesn't get built as favicon is requested by the browser when loading any route.
            if (opts.dev && !matchedOutput && parsedUrl.pathname === '/favicon.ico') {
                res.statusCode = 404;
                res.end('');
                return null;
            }
            const appNotFound = opts.dev ? development == null ? void 0 : (_development_bundler = development.bundler) == null ? void 0 : _development_bundler.serverFields.hasAppNotFound : await fsChecker.getItem(_constants.UNDERSCORE_NOT_FOUND_ROUTE);
            res.statusCode = 404;
            if (appNotFound) {
                return await invokeRender(parsedUrl, _constants.UNDERSCORE_NOT_FOUND_ROUTE, handleIndex, {
                    invokeStatus: 404
                });
            }
            await invokeRender(parsedUrl, '/404', handleIndex, {
                invokeStatus: 404
            });
        };
        try {
            await handleRequest(0);
        } catch (err) {
            try {
                let invokePath = '/500';
                let invokeStatus = '500';
                if (err instanceof _utils.DecodeError) {
                    invokePath = '/400';
                    invokeStatus = '400';
                } else {
                    console.error(err);
                }
                res.statusCode = Number(invokeStatus);
                return await invokeRender((0, _parseurl.parseUrl)(invokePath), invokePath, 0, {
                    invokeStatus: res.statusCode
                });
            } catch (err2) {
                console.error(err2);
            }
            res.statusCode = 500;
            res.end('Internal Server Error');
        }
    };
    let requestHandler = requestHandlerImpl;
    if (config.experimental.testProxy) {
        // Intercept fetch and other testmode apis.
        const { wrapRequestHandlerWorker, interceptTestApis } = // eslint-disable-next-line @next/internal/typechecked-require -- experimental/testmode is not built ins next/dist/esm
        require('next/dist/experimental/testmode/server');
        requestHandler = wrapRequestHandlerWorker(requestHandler);
        interceptTestApis();
        // We treat the intercepted fetch as "original" fetch that should be reset to during HMR.
        originalFetch = globalThis.fetch;
    }
    requestHandlers[opts.dir] = requestHandler;
    const renderServerOpts = {
        port: opts.port,
        dir: opts.dir,
        hostname: opts.hostname,
        minimalMode: opts.minimalMode,
        dev: !!opts.dev,
        server: opts.server,
        serverFields: {
            ...(development == null ? void 0 : (_development_bundler = development.bundler) == null ? void 0 : _development_bundler.serverFields) || {},
            setIsrStatus: development == null ? void 0 : (_development_service = development.service) == null ? void 0 : _development_service.setIsrStatus.bind(development == null ? void 0 : development.service)
        },
        experimentalTestProxy: !!config.experimental.testProxy,
        experimentalHttpsServer: !!opts.experimentalHttpsServer,
        bundlerService: development == null ? void 0 : development.service,
        startServerSpan: opts.startServerSpan,
        quiet: opts.quiet,
        onDevServerCleanup: opts.onDevServerCleanup,
        distDir: config.distDir,
        experimentalFeatures,
        cacheComponents: config.cacheComponents
    };
    renderServerOpts.serverFields.routerServerHandler = requestHandlerImpl;
    // pre-initialize workers
    const handlers = await renderServer.instance.initialize(renderServerOpts);
    // this must come after initialize of render server since it's
    // using initialized methods
    if (!_routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol]) {
        _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol] = {};
    }
    const relativeProjectDir = _path.default.relative(process.cwd(), opts.dir);
    _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol][relativeProjectDir] = {
        nextConfig: (0, _configshared.getNextConfigRuntime)(config),
        hostname: handlers.server.hostname,
        revalidate: handlers.server.revalidate.bind(handlers.server),
        render404: handlers.server.render404.bind(handlers.server),
        experimentalTestProxy: renderServerOpts.experimentalTestProxy,
        logErrorWithOriginalStack: opts.dev ? handlers.server.logErrorWithOriginalStack.bind(handlers.server) : (err)=>!opts.quiet && _log.error(err),
        setCacheStatus: config.cacheComponents ? development == null ? void 0 : (_development_service1 = development.service) == null ? void 0 : _development_service1.setCacheStatus.bind(development == null ? void 0 : development.service) : undefined,
        setIsrStatus: development == null ? void 0 : (_development_service2 = development.service) == null ? void 0 : _development_service2.setIsrStatus.bind(development == null ? void 0 : development.service),
        setReactDebugChannel: (development == null ? void 0 : development.config.experimental.reactDebugChannel) ? development == null ? void 0 : (_development_service3 = development.service) == null ? void 0 : _development_service3.setReactDebugChannel.bind(development == null ? void 0 : development.service) : undefined,
        sendErrorsToBrowser: development == null ? void 0 : (_development_service4 = development.service) == null ? void 0 : _development_service4.sendErrorsToBrowser.bind(development == null ? void 0 : development.service)
    };
    const logError = async (type, err)=>{
        if ((0, _ispostpone.isPostpone)(err)) {
            // React postpones that are unhandled might end up logged here but they're
            // not really errors. They're just part of rendering.
            return;
        }
        if (type === 'unhandledRejection') {
            _log.error('unhandledRejection: ', err);
        } else if (type === 'uncaughtException') {
            _log.error('uncaughtException: ', err);
        }
    };
    process.on('uncaughtException', logError.bind(null, 'uncaughtException'));
    process.on('unhandledRejection', logError.bind(null, 'unhandledRejection'));
    const resolveRoutes = (0, _resolveroutes.getResolveRoutes)(fsChecker, config, opts, renderServer.instance, renderServerOpts, development == null ? void 0 : (_development_bundler1 = development.bundler) == null ? void 0 : _development_bundler1.ensureMiddleware);
    const upgradeHandler = async (req, socket, head)=>{
        try {
            req.on('error', (_err)=>{
            // TODO: log socket errors?
            // console.error(_err);
            });
            socket.on('error', (_err)=>{
            // TODO: log socket errors?
            // console.error(_err);
            });
            if (opts.dev && development && req.url) {
                if ((0, _blockcrosssitedev.blockCrossSiteDEV)(req, socket, development.config.allowedDevOrigins, opts.hostname)) {
                    return;
                }
                const { basePath, assetPrefix } = config;
                let hmrPrefix = basePath;
                // assetPrefix overrides basePath for HMR path
                if (assetPrefix) {
                    hmrPrefix = (0, _normalizedassetprefix.normalizedAssetPrefix)(assetPrefix);
                    if (URL.canParse(hmrPrefix)) {
                        // remove trailing slash from pathname
                        // return empty string if pathname is '/'
                        // to avoid conflicts with '/_next' below
                        hmrPrefix = new URL(hmrPrefix).pathname.replace(/\/$/, '');
                    }
                }
                const isHMRRequest = req.url.startsWith((0, _ensureleadingslash.ensureLeadingSlash)(`${hmrPrefix}/_next/webpack-hmr`));
                // only handle HMR requests if the basePath in the request
                // matches the basePath for the handler responding to the request
                if (isHMRRequest) {
                    return development.bundler.hotReloader.onHMR(req, socket, head, (client, { isLegacyClient })=>{
                        if (isLegacyClient) {
                            var _development_service;
                            // Only send the ISR manifest to legacy clients, i.e. Pages
                            // Router clients, or App Router clients that have Cache
                            // Components disabled. The ISR manifest is only used to inform
                            // the static indicator, which currently does not provide useful
                            // information if Cache Components is enabled due to its binary
                            // nature (i.e. it does not support showing info for partially
                            // static pages).
                            client.send(JSON.stringify({
                                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ISR_MANIFEST,
                                data: ((_development_service = development.service) == null ? void 0 : _development_service.appIsrManifest) || {}
                            }));
                        }
                    });
                }
            }
            const res = new _mockrequest.MockedResponse({
                resWriter: ()=>{
                    throw Object.defineProperty(new Error('Invariant: did not expect response writer to be written to for upgrade request'), "__NEXT_ERROR_CODE", {
                        value: "E522",
                        enumerable: false,
                        configurable: true
                    });
                }
            });
            const { matchedOutput, parsedUrl } = await resolveRoutes({
                req,
                res,
                isUpgradeReq: true,
                signal: (0, _nextrequest.signalFromNodeResponse)(socket)
            });
            // TODO: allow upgrade requests to pages/app paths?
            // this was not previously supported
            if (matchedOutput) {
                return socket.end();
            }
            if (parsedUrl.protocol) {
                return await (0, _proxyrequest.proxyRequest)(req, socket, parsedUrl, head);
            }
        // If there's no matched output, we don't handle the request as user's
        // custom WS server may be listening on the same path.
        } catch (err) {
            console.error('Error handling upgrade request', err);
            socket.end();
        }
    };
    return {
        requestHandler,
        upgradeHandler,
        server: handlers.server,
        closeUpgraded () {
            var _development_bundler_hotReloader, _development_bundler;
            development == null ? void 0 : (_development_bundler = development.bundler) == null ? void 0 : (_development_bundler_hotReloader = _development_bundler.hotReloader) == null ? void 0 : _development_bundler_hotReloader.close();
        },
        distDir: config.distDir,
        experimentalFeatures,
        cacheComponents: config.cacheComponents
    };
}

//# sourceMappingURL=router-server.js.map