"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getDefineEnv", {
    enumerable: true,
    get: function() {
        return getDefineEnv;
    }
});
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
const _needsexperimentalreact = require("../lib/needs-experimental-react");
const _ppr = require("../server/lib/experimental/ppr");
const _staticenv = require("../lib/static-env");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const DEFINE_ENV_EXPRESSION = Symbol('DEFINE_ENV_EXPRESSION');
/**
 * Serializes the DefineEnv config so that it can be inserted into the code by Webpack/Turbopack, JSON stringifies each value.
 */ function serializeDefineEnv(defineEnv) {
    const defineEnvStringified = Object.fromEntries(Object.entries(defineEnv).map(([key, value])=>[
            key,
            typeof value === 'object' && DEFINE_ENV_EXPRESSION in value ? value[DEFINE_ENV_EXPRESSION] : JSON.stringify(value)
        ]));
    return defineEnvStringified;
}
function getImageConfig(config, dev) {
    var _config_images, _config_images1, _config_images2;
    return {
        'process.env.__NEXT_IMAGE_OPTS': {
            deviceSizes: config.images.deviceSizes,
            imageSizes: config.images.imageSizes,
            qualities: config.images.qualities,
            path: config.images.path,
            loader: config.images.loader,
            dangerouslyAllowSVG: config.images.dangerouslyAllowSVG,
            unoptimized: config == null ? void 0 : (_config_images = config.images) == null ? void 0 : _config_images.unoptimized,
            ...dev ? {
                // additional config in dev to allow validating on the client
                domains: config.images.domains,
                remotePatterns: (_config_images1 = config.images) == null ? void 0 : _config_images1.remotePatterns,
                localPatterns: (_config_images2 = config.images) == null ? void 0 : _config_images2.localPatterns,
                output: config.output
            } : {}
        }
    };
}
function getDefineEnv({ isTurbopack, clientRouterFilters, config, dev, distDir, projectPath, fetchCacheKeyPrefix, hasRewrites, isClient, isEdgeServer, isNodeServer, middlewareMatchers, omitNonDeterministic, rewrites }) {
    var _config_experimental, _config_experimental1, _config_experimental_staleTimes, _config_experimental_staleTimes1, _config_experimental_staleTimes2, _config_experimental_staleTimes3, _config_i18n, _config_compiler;
    const nextPublicEnv = (0, _staticenv.getNextPublicEnvironmentVariables)();
    const nextConfigEnv = (0, _staticenv.getNextConfigEnv)(config);
    const isPPREnabled = (0, _ppr.checkIsAppPPREnabled)(config.experimental.ppr);
    const isCacheComponentsEnabled = !!config.cacheComponents;
    const isUseCacheEnabled = !!config.experimental.useCache;
    const defineEnv = {
        // internal field to identify the plugin config
        __NEXT_DEFINE_ENV: true,
        ...nextPublicEnv,
        ...nextConfigEnv,
        ...!isEdgeServer ? {} : {
            EdgeRuntime: /**
             * Cloud providers can set this environment variable to allow users
             * and library authors to have different implementations based on
             * the runtime they are running with, if it's not using `edge-runtime`
             */ process.env.NEXT_EDGE_RUNTIME_PROVIDER ?? 'edge-runtime',
            // process should be only { env: {...} } for edge runtime.
            // For ignore avoid warn on `process.emit` usage but directly omit it.
            'process.emit': false
        },
        'process.turbopack': isTurbopack,
        'process.env.TURBOPACK': isTurbopack,
        'process.env.__NEXT_BUNDLER': isTurbopack ? 'Turbopack' : process.env.NEXT_RSPACK ? 'Rspack' : 'Webpack',
        // TODO: enforce `NODE_ENV` on `process.env`, and add a test:
        'process.env.NODE_ENV': dev || config.experimental.allowDevelopmentBuild ? 'development' : 'production',
        'process.env.__NEXT_DEV_SERVER': dev ? '1' : '',
        'process.env.NEXT_RUNTIME': isEdgeServer ? 'edge' : isNodeServer ? 'nodejs' : '',
        'process.env.NEXT_MINIMAL': '',
        'process.env.__NEXT_APP_NAV_FAIL_HANDLING': Boolean(config.experimental.appNavFailHandling),
        'process.env.__NEXT_APP_NEW_SCROLL_HANDLER': Boolean(config.experimental.appNewScrollHandler),
        'process.env.__NEXT_PPR': isPPREnabled,
        'process.env.__NEXT_CACHE_COMPONENTS': isCacheComponentsEnabled,
        'process.env.__NEXT_EXPERIMENTAL_CACHED_NAVIGATIONS': Boolean(config.experimental.cachedNavigations),
        'process.env.__NEXT_INSTANT_NAV_TOGGLE': !!config.experimental.instantNavigationDevToolsToggle,
        'process.env.__NEXT_USE_CACHE': isUseCacheEnabled,
        'process.env.NEXT_IMMUTABLE_ASSET_TOKEN': config.experimental.immutableAssetToken || '',
        ...((_config_experimental = config.experimental) == null ? void 0 : _config_experimental.useSkewCookie) || !config.deploymentId ? {
            'process.env.NEXT_DEPLOYMENT_ID': false
        } : isClient ? isTurbopack ? {
            // This is set at runtime by packages/next/src/client/register-deployment-id-global.ts
            'process.env.NEXT_DEPLOYMENT_ID': {
                [DEFINE_ENV_EXPRESSION]: 'globalThis.NEXT_DEPLOYMENT_ID'
            }
        } : {
            // For Webpack, we currently don't use the non-inlining globalThis.NEXT_DEPLOYMENT_ID
            // approach because we cannot forward this global variable to web workers easily.
            'process.env.NEXT_DEPLOYMENT_ID': config.deploymentId || false
        } : ((_config_experimental1 = config.experimental) == null ? void 0 : _config_experimental1.runtimeServerDeploymentId) ? {
        } : {
            'process.env.NEXT_DEPLOYMENT_ID': config.deploymentId || false
        },
        // Propagates the `__NEXT_EXPERIMENTAL_STATIC_SHELL_DEBUGGING` environment
        // variable to the client.
        'process.env.__NEXT_EXPERIMENTAL_STATIC_SHELL_DEBUGGING': process.env.__NEXT_EXPERIMENTAL_STATIC_SHELL_DEBUGGING || false,
        'process.env.__NEXT_FETCH_CACHE_KEY_PREFIX': fetchCacheKeyPrefix ?? '',
        ...isTurbopack ? {} : {
            'process.env.__NEXT_MIDDLEWARE_MATCHERS': middlewareMatchers ?? []
        },
        'process.env.__NEXT_MANUAL_CLIENT_BASE_PATH': config.experimental.manualClientBasePath ?? false,
        'process.env.__NEXT_CLIENT_ROUTER_DYNAMIC_STALETIME': JSON.stringify(isNaN(Number((_config_experimental_staleTimes = config.experimental.staleTimes) == null ? void 0 : _config_experimental_staleTimes.dynamic)) ? 0 : (_config_experimental_staleTimes1 = config.experimental.staleTimes) == null ? void 0 : _config_experimental_staleTimes1.dynamic),
        'process.env.__NEXT_CLIENT_ROUTER_STATIC_STALETIME': JSON.stringify(isNaN(Number((_config_experimental_staleTimes2 = config.experimental.staleTimes) == null ? void 0 : _config_experimental_staleTimes2.static)) ? 5 * 60 // 5 minutes
         : (_config_experimental_staleTimes3 = config.experimental.staleTimes) == null ? void 0 : _config_experimental_staleTimes3.static),
        'process.env.__NEXT_CLIENT_ROUTER_FILTER_ENABLED': config.experimental.clientRouterFilter ?? true,
        'process.env.__NEXT_CLIENT_ROUTER_S_FILTER': (clientRouterFilters == null ? void 0 : clientRouterFilters.staticFilter) ?? false,
        'process.env.__NEXT_CLIENT_ROUTER_D_FILTER': (clientRouterFilters == null ? void 0 : clientRouterFilters.dynamicFilter) ?? false,
        'process.env.__NEXT_CLIENT_VALIDATE_RSC_REQUEST_HEADERS': Boolean(config.experimental.validateRSCRequestHeaders),
        'process.env.__NEXT_DYNAMIC_ON_HOVER': Boolean(config.experimental.dynamicOnHover),
        'process.env.__NEXT_PREFETCH_INLINING': Boolean(config.experimental.prefetchInlining),
        'process.env.__NEXT_OPTIMISTIC_CLIENT_CACHE': config.experimental.optimisticClientCache ?? true,
        'process.env.__NEXT_MIDDLEWARE_PREFETCH': config.experimental.proxyPrefetch ?? 'flexible',
        'process.env.__NEXT_CROSS_ORIGIN': config.crossOrigin,
        'process.browser': isClient,
        'process.env.__NEXT_TEST_MODE': process.env.__NEXT_TEST_MODE ?? false,
        // This is used in client/dev-error-overlay/hot-dev-client.js to replace the dist directory
        ...dev && (isClient ?? isEdgeServer) ? {
            'process.env.__NEXT_DIST_DIR': distDir
        } : {},
        // This is used in devtools to strip the project path in edge runtime,
        // as there's only a dummy `dir` value (`.`) as edge runtime doesn't have concept of file system.
        ...dev && isEdgeServer ? {
            'process.env.__NEXT_EDGE_PROJECT_DIR': isTurbopack ? _nodepath.default.relative(process.cwd(), projectPath) : projectPath
        } : {},
        'process.env.__NEXT_BASE_PATH': config.basePath,
        'process.env.__NEXT_CASE_SENSITIVE_ROUTES': Boolean(config.experimental.caseSensitiveRoutes),
        'process.env.__NEXT_REWRITES': rewrites,
        'process.env.__NEXT_TRAILING_SLASH': config.trailingSlash,
        'process.env.__NEXT_DEV_INDICATOR': config.devIndicators !== false,
        'process.env.__NEXT_DEV_INDICATOR_POSITION': config.devIndicators === false ? 'bottom-left' // This will not be used as the indicator is disabled.
         : config.devIndicators.position ?? 'bottom-left',
        'process.env.__NEXT_STRICT_MODE': config.reactStrictMode === null ? false : config.reactStrictMode,
        'process.env.__NEXT_STRICT_MODE_APP': // When next.config.js does not have reactStrictMode it's enabled by default.
        config.reactStrictMode === null ? true : config.reactStrictMode,
        'process.env.__NEXT_OPTIMIZE_CSS': (config.experimental.optimizeCss && !dev) ?? false,
        'process.env.__NEXT_SCRIPT_WORKERS': (config.experimental.nextScriptWorkers && !dev) ?? false,
        'process.env.__NEXT_SCROLL_RESTORATION': config.experimental.scrollRestoration ?? false,
        ...getImageConfig(config, dev),
        'process.env.__NEXT_ROUTER_BASEPATH': config.basePath,
        'process.env.__NEXT_HAS_REWRITES': hasRewrites,
        'process.env.__NEXT_CONFIG_OUTPUT': config.output,
        'process.env.__NEXT_I18N_SUPPORT': !!config.i18n,
        'process.env.__NEXT_I18N_DOMAINS': ((_config_i18n = config.i18n) == null ? void 0 : _config_i18n.domains) ?? false,
        'process.env.__NEXT_I18N_CONFIG': config.i18n || '',
        'process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE': config.skipProxyUrlNormalize,
        'process.env.__NEXT_EXTERNAL_MIDDLEWARE_REWRITE_RESOLVE': config.experimental.externalProxyRewritesResolve ?? false,
        'process.env.__NEXT_MANUAL_TRAILING_SLASH': config.skipTrailingSlashRedirect,
        'process.env.__NEXT_HAS_WEB_VITALS_ATTRIBUTION': (config.experimental.webVitalsAttribution && config.experimental.webVitalsAttribution.length > 0) ?? false,
        'process.env.__NEXT_WEB_VITALS_ATTRIBUTION': config.experimental.webVitalsAttribution ?? false,
        'process.env.__NEXT_LINK_NO_TOUCH_START': config.experimental.linkNoTouchStart ?? false,
        'process.env.__NEXT_ASSET_PREFIX': config.assetPrefix,
        'process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS': !!config.experimental.authInterrupts,
        'process.env.__NEXT_TELEMETRY_DISABLED': Boolean(process.env.NEXT_TELEMETRY_DISABLED),
        ...isNodeServer || isEdgeServer ? {
            // Fix bad-actors in the npm ecosystem (e.g. `node-formidable`)
            // This is typically found in unmaintained modules from the
            // pre-webpack era (common in server-side code)
            'global.GENTLY': false
        } : undefined,
        ...isNodeServer || isEdgeServer ? {
            'process.env.__NEXT_EXPERIMENTAL_REACT': (0, _needsexperimentalreact.needsExperimentalReact)(config)
        } : undefined,
        'process.env.__NEXT_MULTI_ZONE_DRAFT_MODE': config.experimental.multiZoneDraftMode ?? false,
        'process.env.__NEXT_TRUST_HOST_HEADER': config.experimental.trustHostHeader ?? false,
        'process.env.__NEXT_ALLOWED_REVALIDATE_HEADERS': config.experimental.allowedRevalidateHeaderKeys ?? [],
        ...isNodeServer || isEdgeServer ? {
            'process.env.__NEXT_RELATIVE_DIST_DIR': config.distDir,
            'process.env.__NEXT_RELATIVE_PROJECT_DIR': _nodepath.default.relative(process.cwd(), projectPath)
        } : {},
        'process.env.__NEXT_BROWSER_DEBUG_INFO_IN_TERMINAL': JSON.stringify(config.logging && config.logging.browserToTerminal || false),
        'process.env.__NEXT_MCP_SERVER': !!config.experimental.mcpServer,
        // The devtools need to know whether or not to show an option to clear the
        // bundler cache. This option may be removed later once Turbopack's
        // filesystem cache feature is more stable.
        //
        // This environment value is currently best-effort:
        // - It's possible to disable the webpack filesystem cache, but it's
        //   unlikely for a user to do that.
        // - Rspack's filesystem cache is unstable and requires a different
        //   configuration than webpack to enable (which we don't do).
        //
        // In the worst case we'll show an option to clear the cache, but it'll be a
        // no-op that just restarts the development server.
        'process.env.__NEXT_BUNDLER_HAS_PERSISTENT_CACHE': !isTurbopack || (config.experimental.turbopackFileSystemCacheForDev ?? false),
        'process.env.__NEXT_REACT_DEBUG_CHANNEL': config.experimental.reactDebugChannel ?? false,
        'process.env.__NEXT_TRANSITION_INDICATOR': config.experimental.transitionIndicator ?? false,
        'process.env.__NEXT_GESTURE_TRANSITION': config.experimental.gestureTransition ?? false,
        'process.env.__NEXT_OPTIMISTIC_ROUTING': config.experimental.optimisticRouting ?? false,
        'process.env.__NEXT_VARY_PARAMS': config.experimental.varyParams ?? false,
        'process.env.__NEXT_EXPOSE_TESTING_API': dev || config.experimental.exposeTestingApiInProductionBuild === true,
        'process.env.__NEXT_CACHE_LIFE': config.cacheLife,
        'process.env.__NEXT_CLIENT_PARAM_PARSING_ORIGINS': config.experimental.clientParamParsingOrigins || []
    };
    const userDefines = ((_config_compiler = config.compiler) == null ? void 0 : _config_compiler.define) ?? {};
    for(const key in userDefines){
        if (defineEnv.hasOwnProperty(key)) {
            throw Object.defineProperty(new Error(`The \`compiler.define\` option is configured to replace the \`${key}\` variable. This variable is either part of a Next.js built-in or is already configured.`), "__NEXT_ERROR_CODE", {
                value: "E688",
                enumerable: false,
                configurable: true
            });
        }
        defineEnv[key] = userDefines[key];
    }
    if (isNodeServer || isEdgeServer) {
        var _config_compiler1;
        const userDefinesServer = ((_config_compiler1 = config.compiler) == null ? void 0 : _config_compiler1.defineServer) ?? {};
        for(const key in userDefinesServer){
            if (defineEnv.hasOwnProperty(key)) {
                throw Object.defineProperty(new Error(`The \`compiler.defineServer\` option is configured to replace the \`${key}\` variable. This variable is either part of a Next.js built-in or is already configured.`), "__NEXT_ERROR_CODE", {
                    value: "E689",
                    enumerable: false,
                    configurable: true
                });
            }
            defineEnv[key] = userDefinesServer[key];
        }
    }
    const serializedDefineEnv = serializeDefineEnv(defineEnv);
    // we delay inlining these values until after the build
    // with flying shuttle enabled so we can update them
    // without invalidating entries
    if (!dev && omitNonDeterministic) {
        // client uses window. instead of leaving process.env
        // in case process isn't polyfilled on client already
        // since by this point it won't be added by webpack
        const safeKey = (key)=>isClient ? `window.${key.split('.').pop()}` : key;
        for(const key in nextPublicEnv){
            serializedDefineEnv[key] = safeKey(key);
        }
        for(const key in nextConfigEnv){
            serializedDefineEnv[key] = safeKey(key);
        }
        if (!config.experimental.runtimeServerDeploymentId) {
            for (const key of [
                'process.env.NEXT_DEPLOYMENT_ID'
            ]){
                serializedDefineEnv[key] = safeKey(key);
            }
        }
    }
    return serializedDefineEnv;
}

//# sourceMappingURL=define-env.js.map