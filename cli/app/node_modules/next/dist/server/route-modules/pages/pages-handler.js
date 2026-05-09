"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getHandler", {
    enumerable: true,
    get: function() {
        return getHandler;
    }
});
const _routekind = require("../../route-kind");
const _constants = require("../../lib/trace/constants");
const _tracer = require("../../lib/trace/tracer");
const _formaturl = require("../../../shared/lib/router/utils/format-url");
const _requestmeta = require("../../request-meta");
const _interopdefault = require("../../app-render/interop-default");
const _utils = require("../../instrumentation/utils");
const _normalizedatapath = require("../../../shared/lib/page-path/normalize-data-path");
const _responsecache = require("../../response-cache");
const _cachecontrol = require("../../lib/cache-control");
const _utils1 = require("../../../shared/lib/utils");
const _redirectstatus = require("../../../lib/redirect-status");
const _constants1 = require("../../../lib/constants");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _sendpayload = require("../../send-payload");
const _renderresult = /*#__PURE__*/ _interop_require_default(require("../../render-result"));
const _utils2 = require("../../response-cache/utils");
const _nofallbackerrorexternal = require("../../../shared/lib/no-fallback-error.external");
const _redirectstatuscode = require("../../../client/components/redirect-status-code");
const _isbot = require("../../../shared/lib/router/utils/is-bot");
const _addpathprefix = require("../../../shared/lib/router/utils/add-path-prefix");
const _removetrailingslash = require("../../../shared/lib/router/utils/remove-trailing-slash");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const getHandler = ({ srcPage: originalSrcPage, config, userland, routeModule, isFallbackError, getStaticPaths, getStaticProps, getServerSideProps })=>{
    return async function handler(req, res, ctx) {
        var _serverFilesManifest_config_experimental, _serverFilesManifest_config;
        if (ctx.requestMeta) {
            (0, _requestmeta.setRequestMeta)(req, ctx.requestMeta);
        }
        if (routeModule.isDev) {
            (0, _requestmeta.addRequestMeta)(req, 'devRequestTimingInternalsEnd', process.hrtime.bigint());
        }
        let srcPage = originalSrcPage;
        // turbopack doesn't normalize `/index` in the page name
        // so we need to to process dynamic routes properly
        // TODO: fix turbopack providing differing value from webpack
        if (process.env.TURBOPACK) {
            srcPage = srcPage.replace(/\/index$/, '') || '/';
        } else if (srcPage === '/index') {
            // we always normalize /index specifically
            srcPage = '/';
        }
        const multiZoneDraftMode = process.env.__NEXT_MULTI_ZONE_DRAFT_MODE;
        const prepareResult = await routeModule.prepare(req, res, {
            srcPage,
            multiZoneDraftMode
        });
        if (!prepareResult) {
            res.statusCode = 400;
            res.end('Bad Request');
            ctx.waitUntil == null ? void 0 : ctx.waitUntil.call(ctx, Promise.resolve());
            return;
        }
        const isMinimalMode = Boolean((0, _requestmeta.getRequestMeta)(req, 'minimalMode'));
        const render404 = async ()=>{
            // TODO: should route-module itself handle rendering the 404
            if (routerServerContext == null ? void 0 : routerServerContext.render404) {
                await routerServerContext.render404(req, res, parsedUrl, false);
            } else {
                res.end('This page could not be found');
            }
        };
        const { buildId, query, params, parsedUrl, originalQuery, originalPathname, buildManifest, fallbackBuildManifest, nextFontManifest, serverFilesManifest, reactLoadableManifest, prerenderManifest, isDraftMode, isOnDemandRevalidate, revalidateOnlyGenerated, locale, locales, defaultLocale, routerServerContext, nextConfig, resolvedPathname, encodedResolvedPathname, deploymentId, clientAssetToken } = prepareResult;
        const isExperimentalCompile = serverFilesManifest == null ? void 0 : (_serverFilesManifest_config = serverFilesManifest.config) == null ? void 0 : (_serverFilesManifest_config_experimental = _serverFilesManifest_config.experimental) == null ? void 0 : _serverFilesManifest_config_experimental.isExperimentalCompile;
        const hasServerProps = Boolean(getServerSideProps);
        const hasStaticProps = Boolean(getStaticProps);
        const hasStaticPaths = Boolean(getStaticPaths);
        const hasGetInitialProps = Boolean((userland.default || userland).getInitialProps);
        let cacheKey = null;
        let isIsrFallback = false;
        let isNextDataRequest = prepareResult.isNextDataRequest && (hasStaticProps || hasServerProps);
        const is404Page = srcPage === '/404';
        const is500Page = srcPage === '/500';
        const isErrorPage = srcPage === '/_error';
        if (!routeModule.isDev && !isDraftMode && hasStaticProps) {
            cacheKey = `${locale ? `/${locale}` : ''}${(srcPage === '/' || resolvedPathname === '/') && locale ? '' : resolvedPathname}`;
            if (is404Page || is500Page || isErrorPage) {
                cacheKey = `${locale ? `/${locale}` : ''}${srcPage}`;
            }
            // ensure /index and / is normalized to one key
            cacheKey = cacheKey === '/index' ? '/' : cacheKey;
        }
        if (hasStaticPaths && !isDraftMode) {
            const decodedPathname = (0, _removetrailingslash.removeTrailingSlash)(locale ? (0, _addpathprefix.addPathPrefix)(resolvedPathname, `/${locale}`) : resolvedPathname);
            const isPrerendered = Boolean(prerenderManifest.routes[decodedPathname]) || prerenderManifest.notFoundRoutes.includes(decodedPathname);
            const prerenderInfo = prerenderManifest.dynamicRoutes[srcPage];
            if (prerenderInfo) {
                if (prerenderInfo.fallback === false && !isPrerendered) {
                    if (nextConfig.adapterPath) {
                        return await render404();
                    }
                    throw new _nofallbackerrorexternal.NoFallbackError();
                }
                if (typeof prerenderInfo.fallback === 'string' && !isPrerendered && !isNextDataRequest) {
                    isIsrFallback = true;
                }
            }
        }
        // When serving a bot request, we want to serve a blocking render and not
        // the prerendered page. This ensures that the correct content is served
        // to the bot in the head.
        if (isIsrFallback && (0, _isbot.isBot)(req.headers['user-agent'] || '') || isMinimalMode) {
            isIsrFallback = false;
        }
        const tracer = (0, _tracer.getTracer)();
        const activeSpan = tracer.getActiveScopeSpan();
        try {
            var _parsedUrl_pathname;
            const method = req.method || 'GET';
            const resolvedUrl = (0, _formaturl.formatUrl)({
                pathname: nextConfig.trailingSlash ? `${encodedResolvedPathname}${!encodedResolvedPathname.endsWith('/') && ((_parsedUrl_pathname = parsedUrl.pathname) == null ? void 0 : _parsedUrl_pathname.endsWith('/')) ? '/' : ''}` : (0, _removetrailingslash.removeTrailingSlash)(encodedResolvedPathname || '/'),
                // make sure to only add query values from original URL
                query: hasStaticProps ? {} : originalQuery
            });
            let parentSpan;
            const handleResponse = async (span)=>{
                const responseGenerator = async ({ previousCacheEntry })=>{
                    var _previousCacheEntry_value;
                    const doRender = async ()=>{
                        try {
                            var _nextConfig_i18n;
                            return await routeModule.render(req, res, {
                                query: hasStaticProps && !isExperimentalCompile ? {
                                    ...params
                                } : {
                                    ...query,
                                    ...params
                                },
                                params,
                                page: srcPage,
                                renderContext: {
                                    isDraftMode,
                                    isFallback: isIsrFallback,
                                    developmentNotFoundSourcePage: (0, _requestmeta.getRequestMeta)(req, 'developmentNotFoundSourcePage')
                                },
                                sharedContext: {
                                    buildId,
                                    customServer: Boolean(routerServerContext == null ? void 0 : routerServerContext.isCustomServer) || undefined,
                                    deploymentId,
                                    clientAssetToken
                                },
                                renderOpts: {
                                    params,
                                    routeModule,
                                    page: srcPage,
                                    pageConfig: config || {},
                                    Component: (0, _interopdefault.interopDefault)(userland),
                                    ComponentMod: userland,
                                    getStaticProps,
                                    getStaticPaths,
                                    getServerSideProps,
                                    supportsDynamicResponse: !hasStaticProps,
                                    buildManifest: isFallbackError ? fallbackBuildManifest : buildManifest,
                                    nextFontManifest,
                                    reactLoadableManifest,
                                    assetPrefix: nextConfig.assetPrefix,
                                    previewProps: prerenderManifest.preview,
                                    images: nextConfig.images,
                                    nextConfigOutput: nextConfig.output,
                                    optimizeCss: Boolean(nextConfig.experimental.optimizeCss),
                                    nextScriptWorkers: Boolean(nextConfig.experimental.nextScriptWorkers),
                                    domainLocales: (_nextConfig_i18n = nextConfig.i18n) == null ? void 0 : _nextConfig_i18n.domains,
                                    crossOrigin: nextConfig.crossOrigin,
                                    multiZoneDraftMode,
                                    basePath: nextConfig.basePath,
                                    disableOptimizedLoading: nextConfig.experimental.disableOptimizedLoading,
                                    largePageDataBytes: nextConfig.experimental.largePageDataBytes,
                                    isExperimentalCompile,
                                    experimental: {
                                        clientTraceMetadata: nextConfig.experimental.clientTraceMetadata || []
                                    },
                                    locale,
                                    locales,
                                    defaultLocale,
                                    setIsrStatus: routerServerContext == null ? void 0 : routerServerContext.setIsrStatus,
                                    isNextDataRequest: isNextDataRequest && (hasServerProps || hasStaticProps),
                                    resolvedUrl,
                                    // For getServerSideProps and getInitialProps we need to ensure we use the original URL
                                    // and not the resolved URL to prevent a hydration mismatch on
                                    // asPath
                                    resolvedAsPath: hasServerProps || hasGetInitialProps ? (0, _formaturl.formatUrl)({
                                        // we use the original URL pathname less the _next/data prefix if
                                        // present
                                        pathname: isNextDataRequest ? (0, _normalizedatapath.normalizeDataPath)(originalPathname) : originalPathname,
                                        query: originalQuery
                                    }) : resolvedUrl,
                                    isOnDemandRevalidate,
                                    ErrorDebug: (0, _requestmeta.getRequestMeta)(req, 'PagesErrorDebug'),
                                    err: (0, _requestmeta.getRequestMeta)(req, 'invokeError'),
                                    // needed for experimental.optimizeCss feature
                                    distDir: _path.default.join(/* turbopackIgnore: true */ process.cwd(), routeModule.relativeProjectDir, routeModule.distDir)
                                }
                            }).then((renderResult)=>{
                                const { metadata } = renderResult;
                                let cacheControl = metadata.cacheControl;
                                if ('isNotFound' in metadata && metadata.isNotFound) {
                                    return {
                                        value: null,
                                        cacheControl
                                    };
                                }
                                // Handle `isRedirect`.
                                if (metadata.isRedirect) {
                                    return {
                                        value: {
                                            kind: _responsecache.CachedRouteKind.REDIRECT,
                                            props: metadata.pageData ?? metadata.flightData
                                        },
                                        cacheControl
                                    };
                                }
                                return {
                                    value: {
                                        kind: _responsecache.CachedRouteKind.PAGES,
                                        html: renderResult,
                                        pageData: renderResult.metadata.pageData,
                                        headers: renderResult.metadata.headers,
                                        status: renderResult.metadata.statusCode
                                    },
                                    cacheControl
                                };
                            }).finally(()=>{
                                if (!span) return;
                                span.setAttributes({
                                    'http.status_code': res.statusCode,
                                    'next.rsc': false
                                });
                                const rootSpanAttributes = tracer.getRootSpanAttributes();
                                // We were unable to get attributes, probably OTEL is not enabled
                                if (!rootSpanAttributes) {
                                    return;
                                }
                                if (rootSpanAttributes.get('next.span_type') !== _constants.BaseServerSpan.handleRequest) {
                                    console.warn(`Unexpected root span type '${rootSpanAttributes.get('next.span_type')}'. Please report this Next.js issue https://github.com/vercel/next.js`);
                                    return;
                                }
                                const route = rootSpanAttributes.get('next.route');
                                if (route) {
                                    const name = `${method} ${route}`;
                                    span.setAttributes({
                                        'next.route': route,
                                        'http.route': route,
                                        'next.span_name': name
                                    });
                                    span.updateName(name);
                                    // Propagate http.route to the parent span if one exists
                                    // (e.g. a platform-created HTTP span in adapter
                                    // deployments).
                                    if (parentSpan && parentSpan !== span) {
                                        parentSpan.setAttribute('http.route', route);
                                        parentSpan.updateName(name);
                                    }
                                } else {
                                    span.updateName(`${method} ${srcPage}`);
                                }
                            });
                        } catch (err) {
                            // if this is a background revalidate we need to report
                            // the request error here as it won't be bubbled
                            if (previousCacheEntry == null ? void 0 : previousCacheEntry.isStale) {
                                const silenceLog = false;
                                await routeModule.onRequestError(req, err, {
                                    routerKind: 'Pages Router',
                                    routePath: srcPage,
                                    routeType: 'render',
                                    revalidateReason: (0, _utils.getRevalidateReason)({
                                        isStaticGeneration: hasStaticProps,
                                        isOnDemandRevalidate
                                    })
                                }, silenceLog, routerServerContext);
                            }
                            throw err;
                        }
                    };
                    // if we've already generated this page we no longer
                    // serve the fallback
                    if (previousCacheEntry) {
                        isIsrFallback = false;
                    }
                    if (isIsrFallback) {
                        const fallbackResponse = await routeModule.getResponseCache(req).get(routeModule.isDev ? null : locale ? `/${locale}${srcPage}` : srcPage, async ({ previousCacheEntry: previousFallbackCacheEntry = null })=>{
                            if (!routeModule.isDev) {
                                return (0, _utils2.toResponseCacheEntry)(previousFallbackCacheEntry);
                            }
                            return doRender();
                        }, {
                            routeKind: _routekind.RouteKind.PAGES,
                            isFallback: true,
                            isRoutePPREnabled: false,
                            isOnDemandRevalidate: false,
                            incrementalCache: await routeModule.getIncrementalCache(req, nextConfig, prerenderManifest, isMinimalMode),
                            waitUntil: ctx.waitUntil
                        });
                        if (fallbackResponse) {
                            // Remove the cache control from the response to prevent it from being
                            // used in the surrounding cache.
                            delete fallbackResponse.cacheControl;
                            fallbackResponse.isMiss = true;
                            return fallbackResponse;
                        }
                    }
                    if (!isMinimalMode && isOnDemandRevalidate && revalidateOnlyGenerated && !previousCacheEntry) {
                        res.statusCode = 404;
                        // on-demand revalidate always sets this header
                        res.setHeader('x-nextjs-cache', 'REVALIDATED');
                        res.end('This page could not be found');
                        return null;
                    }
                    if (isIsrFallback && (previousCacheEntry == null ? void 0 : (_previousCacheEntry_value = previousCacheEntry.value) == null ? void 0 : _previousCacheEntry_value.kind) === _responsecache.CachedRouteKind.PAGES) {
                        return {
                            value: {
                                kind: _responsecache.CachedRouteKind.PAGES,
                                html: new _renderresult.default(Buffer.from(previousCacheEntry.value.html), {
                                    contentType: _constants1.HTML_CONTENT_TYPE_HEADER,
                                    metadata: {
                                        statusCode: previousCacheEntry.value.status,
                                        headers: previousCacheEntry.value.headers
                                    }
                                }),
                                pageData: {},
                                status: previousCacheEntry.value.status,
                                headers: previousCacheEntry.value.headers
                            },
                            cacheControl: {
                                revalidate: 0,
                                expire: undefined
                            }
                        };
                    }
                    return doRender();
                };
                const result = await routeModule.handleResponse({
                    cacheKey,
                    req,
                    nextConfig,
                    routeKind: _routekind.RouteKind.PAGES,
                    isOnDemandRevalidate,
                    revalidateOnlyGenerated,
                    waitUntil: ctx.waitUntil,
                    responseGenerator: responseGenerator,
                    prerenderManifest,
                    isMinimalMode
                });
                // if we got a cache hit this wasn't an ISR fallback
                // but it wasn't generated during build so isn't in the
                // prerender-manifest
                if (isIsrFallback && !(result == null ? void 0 : result.isMiss)) {
                    isIsrFallback = false;
                }
                // response is finished is no cache entry
                if (!result) {
                    return;
                }
                if (hasStaticProps && !isMinimalMode) {
                    res.setHeader('x-nextjs-cache', isOnDemandRevalidate ? 'REVALIDATED' : result.isMiss ? 'MISS' : result.isStale ? 'STALE' : 'HIT');
                }
                let cacheControl;
                if (!hasStaticProps || isIsrFallback) {
                    if (!res.getHeader('Cache-Control')) {
                        cacheControl = {
                            revalidate: 0,
                            expire: undefined
                        };
                    }
                } else if (is404Page) {
                    const notFoundRevalidate = (0, _requestmeta.getRequestMeta)(req, 'notFoundRevalidate');
                    cacheControl = {
                        revalidate: typeof notFoundRevalidate === 'undefined' ? 0 : notFoundRevalidate,
                        expire: undefined
                    };
                } else if (is500Page) {
                    cacheControl = {
                        revalidate: 0,
                        expire: undefined
                    };
                } else if (result.cacheControl) {
                    // If the cache entry has a cache control with a revalidate value that's
                    // a number, use it.
                    if (typeof result.cacheControl.revalidate === 'number') {
                        var _result_cacheControl;
                        if (result.cacheControl.revalidate < 1) {
                            throw Object.defineProperty(new Error(`Invalid revalidate configuration provided: ${result.cacheControl.revalidate} < 1`), "__NEXT_ERROR_CODE", {
                                value: "E22",
                                enumerable: false,
                                configurable: true
                            });
                        }
                        cacheControl = {
                            revalidate: result.cacheControl.revalidate,
                            expire: ((_result_cacheControl = result.cacheControl) == null ? void 0 : _result_cacheControl.expire) ?? nextConfig.expireTime
                        };
                    } else {
                        // revalidate: false
                        cacheControl = {
                            revalidate: _constants1.CACHE_ONE_YEAR_SECONDS,
                            expire: undefined
                        };
                    }
                }
                // If cache control is already set on the response we don't
                // override it to allow users to customize it via next.config
                if (cacheControl && !res.getHeader('Cache-Control')) {
                    res.setHeader('Cache-Control', (0, _cachecontrol.getCacheControlHeader)(cacheControl));
                }
                // notFound: true case
                if (!result.value) {
                    var _result_cacheControl1;
                    // add revalidate metadata before rendering 404 page
                    // so that we can use this as source of truth for the
                    // cache-control header instead of what the 404 page returns
                    // for the revalidate value
                    (0, _requestmeta.addRequestMeta)(req, 'notFoundRevalidate', (_result_cacheControl1 = result.cacheControl) == null ? void 0 : _result_cacheControl1.revalidate);
                    res.statusCode = 404;
                    if (isNextDataRequest) {
                        if (deploymentId) {
                            res.setHeader(_constants1.NEXT_NAV_DEPLOYMENT_ID_HEADER, deploymentId);
                        }
                        res.end('{"notFound":true}');
                        return;
                    }
                    return await render404();
                }
                if (result.value.kind === _responsecache.CachedRouteKind.REDIRECT) {
                    if (isNextDataRequest) {
                        if (deploymentId) {
                            res.setHeader(_constants1.NEXT_NAV_DEPLOYMENT_ID_HEADER, deploymentId);
                        }
                        res.setHeader('content-type', _constants1.JSON_CONTENT_TYPE_HEADER);
                        res.end(JSON.stringify(result.value.props));
                        return;
                    } else {
                        const handleRedirect = (pageData)=>{
                            const redirect = {
                                destination: pageData.pageProps.__N_REDIRECT,
                                statusCode: pageData.pageProps.__N_REDIRECT_STATUS,
                                basePath: pageData.pageProps.__N_REDIRECT_BASE_PATH
                            };
                            const statusCode = (0, _redirectstatus.getRedirectStatus)(redirect);
                            const { basePath } = nextConfig;
                            if (basePath && redirect.basePath !== false && redirect.destination.startsWith('/')) {
                                redirect.destination = `${basePath}${redirect.destination}`;
                            }
                            if (redirect.destination.startsWith('/')) {
                                redirect.destination = (0, _utils1.normalizeRepeatedSlashes)(redirect.destination);
                            }
                            res.statusCode = statusCode;
                            res.setHeader('Location', redirect.destination);
                            if (statusCode === _redirectstatuscode.RedirectStatusCode.PermanentRedirect) {
                                res.setHeader('Refresh', `0;url=${redirect.destination}`);
                            }
                            res.end(redirect.destination);
                        };
                        await handleRedirect(result.value.props);
                        return null;
                    }
                }
                if (result.value.kind !== _responsecache.CachedRouteKind.PAGES) {
                    throw Object.defineProperty(new Error(`Invariant: received non-pages cache entry in pages handler`), "__NEXT_ERROR_CODE", {
                        value: "E695",
                        enumerable: false,
                        configurable: true
                    });
                }
                // In dev, we should not cache pages for any reason.
                if (routeModule.isDev) {
                    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
                }
                // Draft mode should never be cached
                if (isDraftMode) {
                    res.setHeader('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
                }
                // when invoking _error before pages/500 we don't actually
                // send the _error response
                if ((0, _requestmeta.getRequestMeta)(req, 'customErrorRender') || isErrorPage && isMinimalMode && res.statusCode === 500) {
                    return null;
                }
                // Add deployment ID header for data requests
                if (isNextDataRequest && !isErrorPage && !is500Page) {
                    if (deploymentId) {
                        res.setHeader(_constants1.NEXT_NAV_DEPLOYMENT_ID_HEADER, deploymentId);
                    }
                }
                await (0, _sendpayload.sendRenderResult)({
                    req,
                    res,
                    // If we are rendering the error page it's not a data request
                    // anymore
                    result: isNextDataRequest && !isErrorPage && !is500Page ? new _renderresult.default(Buffer.from(JSON.stringify(result.value.pageData)), {
                        contentType: _constants1.JSON_CONTENT_TYPE_HEADER,
                        metadata: result.value.html.metadata
                    }) : result.value.html,
                    generateEtags: nextConfig.generateEtags,
                    poweredByHeader: nextConfig.poweredByHeader,
                    cacheControl: routeModule.isDev ? undefined : cacheControl
                });
            };
            // TODO: activeSpan code path is for when wrapped by
            // next-server can be removed when this is no longer used
            if (activeSpan) {
                await handleResponse();
            } else {
                parentSpan = tracer.getActiveScopeSpan();
                await tracer.withPropagatedContext(req.headers, ()=>tracer.trace(_constants.BaseServerSpan.handleRequest, {
                        spanName: `${method} ${srcPage}`,
                        kind: _tracer.SpanKind.SERVER,
                        attributes: {
                            'http.method': method,
                            'http.target': req.url
                        }
                    }, handleResponse));
            }
        } catch (err) {
            if (!(err instanceof _nofallbackerrorexternal.NoFallbackError)) {
                const silenceLog = false;
                await routeModule.onRequestError(req, err, {
                    routerKind: 'Pages Router',
                    routePath: srcPage,
                    routeType: 'render',
                    revalidateReason: (0, _utils.getRevalidateReason)({
                        isStaticGeneration: hasStaticProps,
                        isOnDemandRevalidate
                    })
                }, silenceLog, routerServerContext);
            }
            // rethrow so that we can handle serving error page
            throw err;
        }
    };
};

//# sourceMappingURL=pages-handler.js.map