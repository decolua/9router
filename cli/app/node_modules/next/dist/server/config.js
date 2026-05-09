"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    default: null,
    normalizeConfig: null,
    warnOptionHasBeenDeprecated: null,
    warnOptionHasBeenMovedOutOfExperimental: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    default: function() {
        return loadConfig;
    },
    normalizeConfig: function() {
        return _configshared.normalizeConfig;
    },
    warnOptionHasBeenDeprecated: function() {
        return warnOptionHasBeenDeprecated;
    },
    warnOptionHasBeenMovedOutOfExperimental: function() {
        return warnOptionHasBeenMovedOutOfExperimental;
    }
});
const _fs = require("fs");
const _path = require("path");
const _url = require("url");
const _findup = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/find-up"));
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
const _ciinfo = /*#__PURE__*/ _interop_require_wildcard(require("../server/ci-info"));
const _constants = require("../shared/lib/constants");
const _configshared = require("./config-shared");
const _configutils = require("./config-utils");
const _imageconfig = require("../shared/lib/image-config");
const _env = require("@next/env");
const _flushtelemetry = require("../telemetry/flush-telemetry");
const _findroot = require("../lib/find-root");
const _setuphttpagentenv = require("./setup-http-agent-env");
const _pathhasprefix = require("../shared/lib/router/utils/path-has-prefix");
const _matchremotepattern = require("../shared/lib/match-remote-pattern");
const _transpileconfig = require("../build/next-config-ts/transpile-config");
const _dset = require("../shared/lib/dset");
const _zod = require("../shared/lib/zod");
const _isbot = require("../shared/lib/router/utils/is-bot");
const _findpagesdir = require("../lib/find-pages-dir");
const _interopdefault = require("../lib/interop-default");
const _hash = require("../shared/lib/hash");
const _harddeprecatedconfigerror = require("../shared/lib/errors/hard-deprecated-config-error");
const _nextinstanceerrorstate = require("./mcp/tools/next-instance-error-state");
const _bundler = require("../lib/bundler");
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
function normalizeNextConfigZodErrors(error) {
    const warnings = [];
    const fatalErrors = [];
    const issues = (0, _zod.normalizeZodErrors)(error);
    for (const { issue, message: originalMessage } of issues){
        let message = originalMessage;
        let shouldExit = false;
        if (issue.path[0] === 'images') {
            // We exit the build when encountering an error in the images config
            shouldExit = true;
        }
        if (issue.code === 'unrecognized_keys' && issue.path[0] === 'experimental') {
            if (message.includes('turbopackPersistentCachingForBuild')) {
                // We exit the build when encountering an error in the turbopackPersistentCaching config
                shouldExit = true;
                message += "\nUse 'experimental.turbopackFileSystemCacheForBuild' instead.";
                message += '\nLearn more: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache';
            } else if (message.includes('turbopackPersistentCaching')) {
                // We exit the build when encountering an error in the turbopackPersistentCaching config
                shouldExit = true;
                message += "\nUse 'experimental.turbopackFileSystemCacheForDev' instead.";
                message += '\nLearn more: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache';
            }
        }
        if (shouldExit) {
            fatalErrors.push(message);
        } else {
            warnings.push(message);
        }
    }
    return [
        warnings,
        fatalErrors
    ];
}
function warnOptionHasBeenDeprecated(config, nestedPropertyKey, reason, silent) {
    let hasWarned = false;
    if (!silent) {
        let current = config;
        let found = true;
        const nestedPropertyKeys = nestedPropertyKey.split('.');
        for (const key of nestedPropertyKeys){
            if (current[key] !== undefined) {
                current = current[key];
            } else {
                found = false;
                break;
            }
        }
        if (found) {
            _log.warnOnce(reason);
            hasWarned = true;
        }
    }
    return hasWarned;
}
function checkDeprecations(userConfig, configFileName, silent, dir) {
    var _userConfig_images_domains, _userConfig_images, _userConfig_experimental;
    warnOptionHasBeenDeprecated(userConfig, 'experimental.middlewarePrefetch', `\`experimental.middlewarePrefetch\` is deprecated. Please use \`experimental.proxyPrefetch\` instead in ${configFileName}.`, silent);
    warnOptionHasBeenDeprecated(userConfig, 'experimental.middlewareClientMaxBodySize', `\`experimental.middlewareClientMaxBodySize\` is deprecated. Please use \`experimental.proxyClientMaxBodySize\` instead in ${configFileName}.`, silent);
    warnOptionHasBeenDeprecated(userConfig, 'experimental.externalMiddlewareRewritesResolve', `\`experimental.externalMiddlewareRewritesResolve\` is deprecated. Please use \`experimental.externalProxyRewritesResolve\` instead in ${configFileName}.`, silent);
    warnOptionHasBeenDeprecated(userConfig, 'skipMiddlewareUrlNormalize', `\`skipMiddlewareUrlNormalize\` is deprecated. Please use \`skipProxyUrlNormalize\` instead in ${configFileName}.`, silent);
    warnOptionHasBeenDeprecated(userConfig, 'experimental.instrumentationHook', `\`experimental.instrumentationHook\` is no longer needed, because \`instrumentation.js\` is available by default. You can remove it from ${configFileName}.`, silent);
    warnOptionHasBeenDeprecated(userConfig, 'experimental.after', `\`experimental.after\` is no longer needed, because \`after\` is available by default. You can remove it from ${configFileName}.`, silent);
    warnOptionHasBeenDeprecated(userConfig, 'eslint', `\`eslint\` configuration in ${configFileName} is no longer supported. See more info here: https://nextjs.org/docs/app/api-reference/cli/next#next-lint-options`, silent);
    if ((_userConfig_images = userConfig.images) == null ? void 0 : (_userConfig_images_domains = _userConfig_images.domains) == null ? void 0 : _userConfig_images_domains.length) {
        warnOptionHasBeenDeprecated(userConfig, 'images.domains', `\`images.domains\` is deprecated in favor of \`images.remotePatterns\`. Please update ${configFileName} to protect your application from malicious users.`, silent);
    }
    // i18n deprecation for App Router
    if (userConfig.i18n) {
        const hasAppDir = Boolean((0, _findpagesdir.findDir)(dir, 'app'));
        if (hasAppDir) {
            warnOptionHasBeenDeprecated(userConfig, 'i18n', `i18n configuration in ${configFileName} is unsupported in App Router.\nLearn more about internationalization in App Router: https://nextjs.org/docs/app/building-your-application/routing/internationalization`, silent);
        }
    }
    // browserDebugInfoInTerminal has moved to logging.browserToTerminal
    if (((_userConfig_experimental = userConfig.experimental) == null ? void 0 : _userConfig_experimental.browserDebugInfoInTerminal) !== undefined) {
        warnOptionHasBeenDeprecated(userConfig, 'experimental.browserDebugInfoInTerminal', `\`experimental.browserDebugInfoInTerminal\` has been moved to \`logging.browserToTerminal\`. Please update your ${configFileName} file accordingly.`, silent);
    }
}
function warnOptionHasBeenMovedOutOfExperimental(config, oldExperimentalKey, newKey, configFileName, silent) {
    if (config.experimental && oldExperimentalKey in config.experimental) {
        if (!silent) {
            _log.warn(`\`experimental.${oldExperimentalKey}\` has been moved to \`${newKey}\`. ` + `Please update your ${configFileName} file accordingly.`);
        }
        let current = config;
        const newKeys = newKey.split('.');
        while(newKeys.length > 1){
            const key = newKeys.shift();
            current[key] = current[key] || {};
            current = current[key];
        }
        ;
        current[newKeys.shift()] = config.experimental[oldExperimentalKey];
    }
    return config;
}
function warnCustomizedOption(config, key, defaultValue, customMessage, configFileName, silent) {
    const segs = key.split('.');
    let current = config;
    while(segs.length >= 1){
        const seg = segs.shift();
        if (!(seg in current)) {
            return;
        }
        current = current[seg];
    }
    if (!silent && current !== defaultValue) {
        _log.warn(`The "${key}" option has been modified. ${customMessage ? customMessage + '. ' : ''}It should be removed from your ${configFileName}.`);
    }
}
/**
 * Assigns defaults to the user config and validates the config.
 *
 * @param dir - The directory of the project.
 * @param userConfig - The user config.
 * @param silent - Whether to suppress warnings.
 * @returns The complete config.
 */ function assignDefaultsAndValidate(dir, userConfig, silent, phase) {
    var _result_experimental, _result_experimental1, _result_experimental_serverActions, _result_experimental2, _userConfig_experimental, _userConfig_experimental1, _userConfig_experimental2, _userConfig_experimental3, _userConfig_experimental4, _userConfig_experimental5, _userConfig_experimental6, _userConfig_experimental7, _userConfig_experimental8, _userConfig_experimental9, _userConfig_experimental10, _userConfig_experimental11, _userConfig_experimental12, _userConfig_experimental13, _userConfig_experimental14, _userConfig_experimental15, _result_experimental3, _result_turbopack, _result_turbopack1, _result_devIndicators, _result_experimental4;
    const configFileName = userConfig.configFileName;
    if (typeof userConfig.exportTrailingSlash !== 'undefined') {
        if (!silent) {
            _log.warn(`The "exportTrailingSlash" option has been renamed to "trailingSlash". Please update your ${configFileName}.`);
        }
        if (typeof userConfig.trailingSlash === 'undefined') {
            userConfig.trailingSlash = userConfig.exportTrailingSlash;
        }
        delete userConfig.exportTrailingSlash;
    }
    const config = Object.keys(userConfig).reduce((currentConfig, key)=>{
        const value = userConfig[key];
        if (value === undefined || value === null) {
            return currentConfig;
        }
        if (key === 'distDir') {
            if (typeof value !== 'string') {
                throw Object.defineProperty(new Error(`Specified distDir is not a string, found type "${typeof value}"`), "__NEXT_ERROR_CODE", {
                    value: "E206",
                    enumerable: false,
                    configurable: true
                });
            }
            const userDistDir = value.trim();
            // don't allow public as the distDir as this is a reserved folder for
            // public files
            if (userDistDir === 'public') {
                throw Object.defineProperty(new Error(`The 'public' directory is reserved in Next.js and can not be set as the 'distDir'. https://nextjs.org/docs/messages/can-not-output-to-public`), "__NEXT_ERROR_CODE", {
                    value: "E221",
                    enumerable: false,
                    configurable: true
                });
            }
            // make sure distDir isn't an empty string as it can result in the provided
            // directory being deleted in development mode
            if (userDistDir.length === 0) {
                throw Object.defineProperty(new Error(`Invalid distDir provided, distDir can not be an empty string. Please remove this config or set it to undefined`), "__NEXT_ERROR_CODE", {
                    value: "E391",
                    enumerable: false,
                    configurable: true
                });
            }
        }
        if (key === 'pageExtensions') {
            if (!Array.isArray(value)) {
                throw Object.defineProperty(new Error(`Specified pageExtensions is not an array of strings, found "${value}". Please update this config or remove it.`), "__NEXT_ERROR_CODE", {
                    value: "E140",
                    enumerable: false,
                    configurable: true
                });
            }
            if (!value.length) {
                throw Object.defineProperty(new Error(`Specified pageExtensions is an empty array. Please update it with the relevant extensions or remove it.`), "__NEXT_ERROR_CODE", {
                    value: "E43",
                    enumerable: false,
                    configurable: true
                });
            }
            value.forEach((ext)=>{
                if (typeof ext !== 'string') {
                    throw Object.defineProperty(new Error(`Specified pageExtensions is not an array of strings, found "${ext}" of type "${typeof ext}". Please update this config or remove it.`), "__NEXT_ERROR_CODE", {
                        value: "E108",
                        enumerable: false,
                        configurable: true
                    });
                }
            });
        }
        const defaultValue = _configshared.defaultConfig[key];
        if (!!value && value.constructor === Object && typeof defaultValue === 'object') {
            currentConfig[key] = {
                ...defaultValue,
                ...Object.keys(value).reduce((c, k)=>{
                    const v = value[k];
                    if (v !== undefined && v !== null) {
                        c[k] = v;
                    }
                    return c;
                }, {})
            };
        } else {
            currentConfig[key] = value;
        }
        return currentConfig;
    }, {});
    const result = {
        ..._configshared.defaultConfig,
        ...config,
        experimental: {
            ..._configshared.defaultConfig.experimental,
            ...config.experimental
        }
    };
    // Normalize prefetchInlining: true | { maxSize?, maxBundleSize? } into a
    // resolved object with concrete defaults, so consumers don't have to
    // resolve the values themselves.
    if (result.experimental.prefetchInlining) {
        const raw = result.experimental.prefetchInlining;
        const maxSize = typeof raw === 'object' ? raw.maxSize ?? 2048 : 2048;
        const maxBundleSize = typeof raw === 'object' ? raw.maxBundleSize ?? 10240 : 10240;
        result.experimental.prefetchInlining = {
            // Clamp Infinity to a finite value so the config survives
            // JSON.stringify (used by output: standalone).
            maxSize: Number.isFinite(maxSize) ? maxSize : Number.MAX_SAFE_INTEGER,
            maxBundleSize: Number.isFinite(maxBundleSize) ? maxBundleSize : Number.MAX_SAFE_INTEGER
        };
    }
    // ensure correct default is set for api-resolver revalidate handling
    if (!result.experimental.trustHostHeader && _ciinfo.hasNextSupport) {
        result.experimental.trustHostHeader = true;
    }
    // Normalize experimental.browserDebugInfoInTerminal to logging.browserToTerminal
    if (result.logging !== false && ((_result_experimental = result.experimental) == null ? void 0 : _result_experimental.browserDebugInfoInTerminal) !== undefined) {
        const loggingConfig = result.logging || {};
        if (!('browserToTerminal' in loggingConfig)) {
            const expConfig = result.experimental.browserDebugInfoInTerminal;
            // Convert object config to simple format (level or true)
            const level = typeof expConfig === 'object' && expConfig !== null ? expConfig.level ?? true : expConfig;
            // Map 'verbose' to true since browserToTerminal doesn't support 'verbose'
            const normalizedValue = level === 'verbose' ? true : level;
            result.logging = {
                ...loggingConfig,
                browserToTerminal: normalizedValue
            };
        }
    }
    if (((_result_experimental1 = result.experimental) == null ? void 0 : _result_experimental1.allowDevelopmentBuild) && process.env.NODE_ENV !== 'development') {
        throw Object.defineProperty(new Error(`The experimental.allowDevelopmentBuild option requires NODE_ENV to be explicitly set to 'development'.`), "__NEXT_ERROR_CODE", {
            value: "E195",
            enumerable: false,
            configurable: true
        });
    }
    // Validate sassOptions.functions is not used with Turbopack
    if (process.env.TURBOPACK && result.sassOptions && 'functions' in result.sassOptions) {
        throw Object.defineProperty(new Error(`The "sassOptions.functions" option is not supported when using Turbopack. ` + `Custom Sass functions are only available with webpack. ` + `Please remove the "functions" property from your sassOptions in ${configFileName}.`), "__NEXT_ERROR_CODE", {
            value: "E893",
            enumerable: false,
            configurable: true
        });
    }
    if (result.experimental.cachedNavigations && !result.cacheComponents) {
        throw Object.defineProperty(new Error(`\`experimental.cachedNavigations\` requires \`cacheComponents\` to be enabled. Please update your ${configFileName} accordingly.`), "__NEXT_ERROR_CODE", {
            value: "E1089",
            enumerable: false,
            configurable: true
        });
    }
    if (result.experimental.ppr) {
        throw new _harddeprecatedconfigerror.HardDeprecatedConfigError(`\`experimental.ppr\` has been merged into \`cacheComponents\`. The Partial Prerendering feature is still available, but is now enabled via \`cacheComponents\`. Please update your ${configFileName} accordingly.`);
    }
    if (result.output === 'export') {
        if (result.i18n) {
            throw Object.defineProperty(new Error('Specified "i18n" cannot be used with "output: export". See more info here: https://nextjs.org/docs/messages/export-no-i18n'), "__NEXT_ERROR_CODE", {
                value: "E493",
                enumerable: false,
                configurable: true
            });
        }
        if (!_ciinfo.hasNextSupport) {
            if (result.rewrites) {
                _log.warn('Specified "rewrites" will not automatically work with "output: export". See more info here: https://nextjs.org/docs/messages/export-no-custom-routes');
            }
            if (result.redirects) {
                _log.warn('Specified "redirects" will not automatically work with "output: export". See more info here: https://nextjs.org/docs/messages/export-no-custom-routes');
            }
            if (result.headers) {
                _log.warn('Specified "headers" will not automatically work with "output: export". See more info here: https://nextjs.org/docs/messages/export-no-custom-routes');
            }
        }
    }
    if (typeof result.assetPrefix !== 'string') {
        throw Object.defineProperty(new Error(`Specified assetPrefix is not a string, found type "${typeof result.assetPrefix}" https://nextjs.org/docs/messages/invalid-assetprefix`), "__NEXT_ERROR_CODE", {
            value: "E68",
            enumerable: false,
            configurable: true
        });
    }
    if (typeof result.basePath !== 'string') {
        throw Object.defineProperty(new Error(`Specified basePath is not a string, found type "${typeof result.basePath}"`), "__NEXT_ERROR_CODE", {
            value: "E326",
            enumerable: false,
            configurable: true
        });
    }
    if (result.basePath !== '') {
        if (result.basePath === '/') {
            throw Object.defineProperty(new Error(`Specified basePath /. basePath has to be either an empty string or a path prefix"`), "__NEXT_ERROR_CODE", {
                value: "E95",
                enumerable: false,
                configurable: true
            });
        }
        if (!result.basePath.startsWith('/')) {
            throw Object.defineProperty(new Error(`Specified basePath has to start with a /, found "${result.basePath}"`), "__NEXT_ERROR_CODE", {
                value: "E105",
                enumerable: false,
                configurable: true
            });
        }
        if (result.basePath !== '/') {
            if (result.basePath.endsWith('/')) {
                throw Object.defineProperty(new Error(`Specified basePath should not end with /, found "${result.basePath}"`), "__NEXT_ERROR_CODE", {
                    value: "E39",
                    enumerable: false,
                    configurable: true
                });
            }
            if (result.assetPrefix === '') {
                result.assetPrefix = result.basePath;
            }
        }
    }
    if (result == null ? void 0 : result.images) {
        const images = result.images;
        if (typeof images !== 'object') {
            throw Object.defineProperty(new Error(`Specified images should be an object received ${typeof images}.\nSee more info here: https://nextjs.org/docs/messages/invalid-images-config`), "__NEXT_ERROR_CODE", {
                value: "E171",
                enumerable: false,
                configurable: true
            });
        }
        if (images.localPatterns) {
            if (!Array.isArray(images.localPatterns)) {
                throw Object.defineProperty(new Error(`Specified images.localPatterns should be an Array received ${typeof images.localPatterns}.\nSee more info here: https://nextjs.org/docs/messages/invalid-images-config`), "__NEXT_ERROR_CODE", {
                    value: "E118",
                    enumerable: false,
                    configurable: true
                });
            }
            // avoid double-pushing the same pattern if it already exists
            const hasMatch = images.localPatterns.some((pattern)=>pattern.pathname === '/_next/static/media/**' && pattern.search === '');
            if (!hasMatch) {
                // static import images are automatically allowed
                images.localPatterns.push({
                    pathname: '/_next/static/media/**',
                    search: ''
                });
            }
        } else {
            // All paths are not allowed for a search query by default.
            images.localPatterns = [
                {
                    pathname: '**',
                    search: ''
                }
            ];
        }
        if (images.remotePatterns) {
            var _config_assetPrefix;
            if (!Array.isArray(images.remotePatterns)) {
                throw Object.defineProperty(new Error(`Specified images.remotePatterns should be an Array received ${typeof images.remotePatterns}.\nSee more info here: https://nextjs.org/docs/messages/invalid-images-config`), "__NEXT_ERROR_CODE", {
                    value: "E27",
                    enumerable: false,
                    configurable: true
                });
            }
            // We must convert URL to RemotePattern since URL has a colon in the protocol
            // and also has additional properties we want to filter out. Also, new URL()
            // accepts any protocol so we need manual validation here.
            images.remotePatterns = images.remotePatterns.map(({ protocol, hostname, port, pathname, search })=>{
                const proto = protocol == null ? void 0 : protocol.replace(/:$/, '');
                if (![
                    'http',
                    'https',
                    undefined
                ].includes(proto)) {
                    throw Object.defineProperty(new Error(`Specified images.remotePatterns must have protocol "http" or "https" received "${proto}".`), "__NEXT_ERROR_CODE", {
                        value: "E671",
                        enumerable: false,
                        configurable: true
                    });
                }
                return {
                    protocol: proto,
                    hostname,
                    port,
                    pathname,
                    search
                };
            });
            // static images are automatically prefixed with assetPrefix
            // so we need to ensure _next/image allows downloading from
            // this resource
            if ((_config_assetPrefix = config.assetPrefix) == null ? void 0 : _config_assetPrefix.startsWith('http')) {
                try {
                    const url = new URL(config.assetPrefix);
                    const hasMatchForAssetPrefix = images.remotePatterns.some((pattern)=>(0, _matchremotepattern.matchRemotePattern)(pattern, url));
                    // avoid double-pushing the same pattern if it already can be matched
                    if (!hasMatchForAssetPrefix) {
                        images.remotePatterns.push({
                            hostname: url.hostname,
                            protocol: url.protocol.replace(/:$/, ''),
                            port: url.port
                        });
                    }
                } catch (error) {
                    throw Object.defineProperty(new Error(`Invalid assetPrefix provided. Original error: ${error}`), "__NEXT_ERROR_CODE", {
                        value: "E343",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
        }
        if (images.domains) {
            if (!Array.isArray(images.domains)) {
                throw Object.defineProperty(new Error(`Specified images.domains should be an Array received ${typeof images.domains}.\nSee more info here: https://nextjs.org/docs/messages/invalid-images-config`), "__NEXT_ERROR_CODE", {
                    value: "E402",
                    enumerable: false,
                    configurable: true
                });
            }
        }
        if (!images.loader) {
            images.loader = 'default';
        }
        if (images.loader !== 'default' && images.loader !== 'custom' && images.path === _imageconfig.imageConfigDefault.path) {
            throw Object.defineProperty(new Error(`Specified images.loader property (${images.loader}) also requires images.path property to be assigned to a URL prefix.\nSee more info here: https://nextjs.org/docs/api-reference/next/legacy/image#loader-configuration`), "__NEXT_ERROR_CODE", {
                value: "E228",
                enumerable: false,
                configurable: true
            });
        }
        if (images.path === _imageconfig.imageConfigDefault.path && result.basePath && !(0, _pathhasprefix.pathHasPrefix)(images.path, result.basePath)) {
            images.path = `${result.basePath}${images.path}`;
        }
        // Append trailing slash for non-default loaders and when trailingSlash is set
        if (images.path && !images.path.endsWith('/') && (images.loader !== 'default' || result.trailingSlash)) {
            images.path += '/';
        }
        if (images.loaderFile) {
            if (images.loader !== 'default' && images.loader !== 'custom') {
                throw Object.defineProperty(new Error(`Specified images.loader property (${images.loader}) cannot be used with images.loaderFile property. Please set images.loader to "custom".`), "__NEXT_ERROR_CODE", {
                    value: "E449",
                    enumerable: false,
                    configurable: true
                });
            }
            const absolutePath = (0, _path.join)(dir, images.loaderFile);
            if (!(0, _fs.existsSync)(absolutePath)) {
                throw Object.defineProperty(new Error(`Specified images.loaderFile does not exist at "${absolutePath}".`), "__NEXT_ERROR_CODE", {
                    value: "E461",
                    enumerable: false,
                    configurable: true
                });
            }
            images.loaderFile = absolutePath;
        }
    }
    warnCustomizedOption(result, 'experimental.esmExternals', true, 'experimental.esmExternals is not recommended to be modified as it may disrupt module resolution', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'bundlePagesExternals', 'bundlePagesRouterDependencies', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'serverComponentsExternalPackages', 'serverExternalPackages', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'relay', 'compiler.relay', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'styledComponents', 'compiler.styledComponents', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'emotion', 'compiler.emotion', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'reactRemoveProperties', 'compiler.reactRemoveProperties', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'removeConsole', 'compiler.removeConsole', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'swrDelta', 'expireTime', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'typedRoutes', 'typedRoutes', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'outputFileTracingRoot', 'outputFileTracingRoot', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'outputFileTracingIncludes', 'outputFileTracingIncludes', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'outputFileTracingExcludes', 'outputFileTracingExcludes', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'reactCompiler', 'reactCompiler', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'enablePrerenderSourceMaps', 'enablePrerenderSourceMaps', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'cacheComponents', 'cacheComponents', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'cacheLife', 'cacheLife', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'cacheHandlers', 'cacheHandlers', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'adapterPath', 'adapterPath', configFileName, silent);
    if (result.experimental.outputStandalone) {
        if (!silent) {
            _log.warn(`experimental.outputStandalone has been renamed to "output: 'standalone'", please move the config.`);
        }
        result.output = 'standalone';
    }
    if (typeof ((_result_experimental2 = result.experimental) == null ? void 0 : (_result_experimental_serverActions = _result_experimental2.serverActions) == null ? void 0 : _result_experimental_serverActions.bodySizeLimit) !== 'undefined') {
        const bytes = require('next/dist/compiled/bytes');
        const bodySizeLimit = result.experimental.serverActions.bodySizeLimit;
        let value;
        if (typeof bodySizeLimit === 'number') {
            value = bodySizeLimit;
        } else {
            value = bytes.parse(bodySizeLimit);
        }
        if (value === null || isNaN(value) || value < 1) {
            throw Object.defineProperty(new Error('Server Actions Size Limit must be a valid number or filesize format larger than 1MB: https://nextjs.org/docs/app/api-reference/next-config-js/serverActions#bodysizelimit'), "__NEXT_ERROR_CODE", {
                value: "E100",
                enumerable: false,
                configurable: true
            });
        }
    }
    // Throw if both Middleware and Proxy config are set.
    if (((_userConfig_experimental = userConfig.experimental) == null ? void 0 : _userConfig_experimental.proxyClientMaxBodySize) !== undefined && ((_userConfig_experimental1 = userConfig.experimental) == null ? void 0 : _userConfig_experimental1.middlewareClientMaxBodySize) !== undefined) {
        throw Object.defineProperty(new Error('Config options `experimental.proxyClientMaxBodySize` and `experimental.middlewareClientMaxBodySize` cannot be set at the same time. Please use `experimental.proxyClientMaxBodySize` instead.'), "__NEXT_ERROR_CODE", {
            value: "E879",
            enumerable: false,
            configurable: true
        });
    }
    if (((_userConfig_experimental2 = userConfig.experimental) == null ? void 0 : _userConfig_experimental2.proxyPrefetch) !== undefined && ((_userConfig_experimental3 = userConfig.experimental) == null ? void 0 : _userConfig_experimental3.middlewarePrefetch) !== undefined) {
        throw Object.defineProperty(new Error('Config options `experimental.proxyPrefetch` and `experimental.middlewarePrefetch` cannot be set at the same time. Please use `experimental.proxyPrefetch` instead.'), "__NEXT_ERROR_CODE", {
            value: "E880",
            enumerable: false,
            configurable: true
        });
    }
    if (((_userConfig_experimental4 = userConfig.experimental) == null ? void 0 : _userConfig_experimental4.externalProxyRewritesResolve) !== undefined && ((_userConfig_experimental5 = userConfig.experimental) == null ? void 0 : _userConfig_experimental5.externalMiddlewareRewritesResolve) !== undefined) {
        throw Object.defineProperty(new Error('Config options `experimental.externalProxyRewritesResolve` and `experimental.externalMiddlewareRewritesResolve` cannot be set at the same time. Please use `experimental.externalProxyRewritesResolve` instead.'), "__NEXT_ERROR_CODE", {
            value: "E877",
            enumerable: false,
            configurable: true
        });
    }
    if (userConfig.skipProxyUrlNormalize !== undefined && userConfig.skipMiddlewareUrlNormalize !== undefined) {
        throw Object.defineProperty(new Error('Config options `skipProxyUrlNormalize` and `skipMiddlewareUrlNormalize` cannot be set at the same time. Please use `skipProxyUrlNormalize` instead.'), "__NEXT_ERROR_CODE", {
            value: "E878",
            enumerable: false,
            configurable: true
        });
    }
    // Map Proxy config to Middleware config as it is currently an alias.
    if (((_userConfig_experimental6 = userConfig.experimental) == null ? void 0 : _userConfig_experimental6.proxyClientMaxBodySize) === undefined && ((_userConfig_experimental7 = userConfig.experimental) == null ? void 0 : _userConfig_experimental7.middlewareClientMaxBodySize) !== undefined) {
        result.experimental.proxyClientMaxBodySize = userConfig.experimental.middlewareClientMaxBodySize;
    }
    if (((_userConfig_experimental8 = userConfig.experimental) == null ? void 0 : _userConfig_experimental8.proxyPrefetch) === undefined && ((_userConfig_experimental9 = userConfig.experimental) == null ? void 0 : _userConfig_experimental9.middlewarePrefetch) !== undefined) {
        result.experimental.proxyPrefetch = userConfig.experimental.middlewarePrefetch;
    }
    if (((_userConfig_experimental10 = userConfig.experimental) == null ? void 0 : _userConfig_experimental10.externalProxyRewritesResolve) === undefined && ((_userConfig_experimental11 = userConfig.experimental) == null ? void 0 : _userConfig_experimental11.externalMiddlewareRewritesResolve) !== undefined) {
        result.experimental.externalProxyRewritesResolve = userConfig.experimental.externalMiddlewareRewritesResolve;
    }
    if (userConfig.skipProxyUrlNormalize === undefined && userConfig.skipMiddlewareUrlNormalize !== undefined) {
        result.skipProxyUrlNormalize = userConfig.skipMiddlewareUrlNormalize;
    }
    // Inverse case: when new name is set but not the old name, copy the value to the old name
    // to avoid breaking change on resolved config object written to `.next/`
    if (((_userConfig_experimental12 = userConfig.experimental) == null ? void 0 : _userConfig_experimental12.proxyPrefetch) !== undefined && ((_userConfig_experimental13 = userConfig.experimental) == null ? void 0 : _userConfig_experimental13.middlewarePrefetch) === undefined) {
        result.experimental.middlewarePrefetch = userConfig.experimental.proxyPrefetch;
    }
    if (((_userConfig_experimental14 = userConfig.experimental) == null ? void 0 : _userConfig_experimental14.externalProxyRewritesResolve) !== undefined && ((_userConfig_experimental15 = userConfig.experimental) == null ? void 0 : _userConfig_experimental15.externalMiddlewareRewritesResolve) === undefined) {
        result.experimental.externalMiddlewareRewritesResolve = userConfig.experimental.externalProxyRewritesResolve;
    }
    if (userConfig.skipProxyUrlNormalize !== undefined && userConfig.skipMiddlewareUrlNormalize === undefined) {
        result.skipMiddlewareUrlNormalize = userConfig.skipProxyUrlNormalize;
    }
    // Normalize & validate experimental.proxyClientMaxBodySize
    if (typeof ((_result_experimental3 = result.experimental) == null ? void 0 : _result_experimental3.proxyClientMaxBodySize) !== 'undefined') {
        const proxyClientMaxBodySize = result.experimental.proxyClientMaxBodySize;
        let normalizedValue;
        if (typeof proxyClientMaxBodySize === 'string') {
            const bytes = require('next/dist/compiled/bytes');
            normalizedValue = bytes.parse(proxyClientMaxBodySize);
        } else if (typeof proxyClientMaxBodySize === 'number') {
            normalizedValue = proxyClientMaxBodySize;
        } else {
            throw Object.defineProperty(new Error('Client Max Body Size must be a valid number (bytes) or filesize format string (e.g., "5mb")'), "__NEXT_ERROR_CODE", {
                value: "E860",
                enumerable: false,
                configurable: true
            });
        }
        if (isNaN(normalizedValue) || normalizedValue < 1) {
            throw Object.defineProperty(new Error('Client Max Body Size must be larger than 0 bytes'), "__NEXT_ERROR_CODE", {
                value: "E861",
                enumerable: false,
                configurable: true
            });
        }
        // Store the normalized value as a number
        result.experimental.proxyClientMaxBodySize = normalizedValue;
    }
    warnOptionHasBeenMovedOutOfExperimental(result, 'transpilePackages', 'transpilePackages', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'skipMiddlewareUrlNormalize', 'skipMiddlewareUrlNormalize', configFileName, silent);
    warnOptionHasBeenMovedOutOfExperimental(result, 'skipTrailingSlashRedirect', 'skipTrailingSlashRedirect', configFileName, silent);
    if ((result == null ? void 0 : result.outputFileTracingRoot) && !(0, _path.isAbsolute)(result.outputFileTracingRoot)) {
        result.outputFileTracingRoot = (0, _path.resolve)(result.outputFileTracingRoot);
        if (!silent) {
            _log.warn(`outputFileTracingRoot should be absolute, using: ${result.outputFileTracingRoot}`);
        }
    }
    if ((result == null ? void 0 : (_result_turbopack = result.turbopack) == null ? void 0 : _result_turbopack.root) && !(0, _path.isAbsolute)(result.turbopack.root)) {
        result.turbopack.root = (0, _path.resolve)(result.turbopack.root);
        if (!silent) {
            _log.warn(`turbopack.root should be absolute, using: ${result.turbopack.root}`);
        }
    }
    if (result.experimental.runtimeServerDeploymentId == null && phase === _constants.PHASE_PRODUCTION_BUILD && _ciinfo.hasNextSupport && process.env.NEXT_DEPLOYMENT_ID) {
        if (result.deploymentId != null && result.deploymentId !== process.env.NEXT_DEPLOYMENT_ID) {
            throw Object.defineProperty(new Error(`The NEXT_DEPLOYMENT_ID environment variable value "${process.env.NEXT_DEPLOYMENT_ID}" does not match the provided deploymentId "${result.deploymentId}" in the config.`), "__NEXT_ERROR_CODE", {
                value: "E971",
                enumerable: false,
                configurable: true
            });
        }
        result.experimental.runtimeServerDeploymentId = true;
    }
    // only leverage deploymentId
    if (process.env.NEXT_DEPLOYMENT_ID) {
        result.deploymentId = process.env.NEXT_DEPLOYMENT_ID;
    }
    // Only read process.env.__NEXT_IMMUTABLE_ASSET_TOKEN to make our testing setup easier. This is
    // actually done by the adapter's modifyConfig
    if (process.env.__NEXT_TEST_MODE && process.env.IS_TURBOPACK_TEST && result.deploymentId && process.env.__NEXT_IMMUTABLE_ASSET_TOKEN) {
        result.experimental.immutableAssetToken = process.env.__NEXT_IMMUTABLE_ASSET_TOKEN;
    }
    const tracingRoot = result == null ? void 0 : result.outputFileTracingRoot;
    const turbopackRoot = result == null ? void 0 : (_result_turbopack1 = result.turbopack) == null ? void 0 : _result_turbopack1.root;
    // If both provided, validate they match. If not, use outputFileTracingRoot.
    if (tracingRoot && turbopackRoot && tracingRoot !== turbopackRoot) {
        _log.warn(`Both \`outputFileTracingRoot\` and \`turbopack.root\` are set, but they must have the same value.\n` + `Using \`outputFileTracingRoot\` value: ${tracingRoot}.`);
    }
    let rootDir = tracingRoot || turbopackRoot;
    if (!rootDir) {
        const { rootDir: foundRootDir, lockFiles } = (0, _findroot.findRootDirAndLockFiles)(dir);
        rootDir = foundRootDir;
        if (!silent) {
            (0, _findroot.warnDuplicatedLockFiles)(lockFiles);
        }
    }
    if (!rootDir) {
        throw Object.defineProperty(new Error('Failed to find the root directory of the project. This is a bug in Next.js.'), "__NEXT_ERROR_CODE", {
            value: "E782",
            enumerable: false,
            configurable: true
        });
    }
    // Ensure both properties are set to the same value
    result.outputFileTracingRoot = rootDir;
    (0, _dset.dset)(result, [
        'turbopack',
        'root'
    ], rootDir);
    (0, _setuphttpagentenv.setHttpClientAndAgentOptions)(result || _configshared.defaultConfig);
    if (result.i18n) {
        const { i18n } = result;
        const i18nType = typeof i18n;
        if (i18nType !== 'object') {
            throw Object.defineProperty(new Error(`Specified i18n should be an object received ${i18nType}.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E148",
                enumerable: false,
                configurable: true
            });
        }
        if (!Array.isArray(i18n.locales)) {
            throw Object.defineProperty(new Error(`Specified i18n.locales should be an Array received ${typeof i18n.locales}.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E227",
                enumerable: false,
                configurable: true
            });
        }
        if (i18n.locales.length > 100 && !silent) {
            _log.warn(`Received ${i18n.locales.length} i18n.locales items which exceeds the recommended max of 100.\nSee more info here: https://nextjs.org/docs/advanced-features/i18n-routing#how-does-this-work-with-static-generation`);
        }
        const defaultLocaleType = typeof i18n.defaultLocale;
        if (!i18n.defaultLocale || defaultLocaleType !== 'string') {
            throw Object.defineProperty(new Error(`Specified i18n.defaultLocale should be a string.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E441",
                enumerable: false,
                configurable: true
            });
        }
        if (typeof i18n.domains !== 'undefined' && !Array.isArray(i18n.domains)) {
            throw Object.defineProperty(new Error(`Specified i18n.domains must be an array of domain objects e.g. [ { domain: 'example.fr', defaultLocale: 'fr', locales: ['fr'] } ] received ${typeof i18n.domains}.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E456",
                enumerable: false,
                configurable: true
            });
        }
        if (i18n.domains) {
            const invalidDomainItems = i18n.domains.filter((item)=>{
                var _i18n_domains;
                if (!item || typeof item !== 'object') return true;
                if (!item.defaultLocale) return true;
                if (!item.domain || typeof item.domain !== 'string') return true;
                if (item.domain.includes(':')) {
                    console.warn(`i18n domain: "${item.domain}" is invalid it should be a valid domain without protocol (https://) or port (:3000) e.g. example.vercel.sh`);
                    return true;
                }
                const defaultLocaleDuplicate = (_i18n_domains = i18n.domains) == null ? void 0 : _i18n_domains.find((altItem)=>altItem.defaultLocale === item.defaultLocale && altItem.domain !== item.domain);
                if (!silent && defaultLocaleDuplicate) {
                    console.warn(`Both ${item.domain} and ${defaultLocaleDuplicate.domain} configured the defaultLocale ${item.defaultLocale} but only one can. Change one item's default locale to continue`);
                    return true;
                }
                let hasInvalidLocale = false;
                if (Array.isArray(item.locales)) {
                    for (const locale of item.locales){
                        if (typeof locale !== 'string') hasInvalidLocale = true;
                        for (const domainItem of i18n.domains || []){
                            if (domainItem === item) continue;
                            if (domainItem.locales && domainItem.locales.includes(locale)) {
                                console.warn(`Both ${item.domain} and ${domainItem.domain} configured the locale (${locale}) but only one can. Remove it from one i18n.domains config to continue`);
                                hasInvalidLocale = true;
                                break;
                            }
                        }
                    }
                }
                return hasInvalidLocale;
            });
            if (invalidDomainItems.length > 0) {
                throw Object.defineProperty(new Error(`Invalid i18n.domains values:\n${invalidDomainItems.map((item)=>JSON.stringify(item)).join('\n')}\n\ndomains value must follow format { domain: 'example.fr', defaultLocale: 'fr', locales: ['fr'] }.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                    value: "E413",
                    enumerable: false,
                    configurable: true
                });
            }
        }
        if (!Array.isArray(i18n.locales)) {
            throw Object.defineProperty(new Error(`Specified i18n.locales must be an array of locale strings e.g. ["en-US", "nl-NL"] received ${typeof i18n.locales}.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E432",
                enumerable: false,
                configurable: true
            });
        }
        const invalidLocales = i18n.locales.filter((locale)=>typeof locale !== 'string');
        if (invalidLocales.length > 0) {
            throw Object.defineProperty(new Error(`Specified i18n.locales contains invalid values (${invalidLocales.map(String).join(', ')}), locales must be valid locale tags provided as strings e.g. "en-US".\n` + `See here for list of valid language sub-tags: http://www.iana.org/assignments/language-subtag-registry/language-subtag-registry`), "__NEXT_ERROR_CODE", {
                value: "E71",
                enumerable: false,
                configurable: true
            });
        }
        if (!i18n.locales.includes(i18n.defaultLocale)) {
            throw Object.defineProperty(new Error(`Specified i18n.defaultLocale should be included in i18n.locales.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E515",
                enumerable: false,
                configurable: true
            });
        }
        const normalizedLocales = new Set();
        const duplicateLocales = new Set();
        i18n.locales.forEach((locale)=>{
            const localeLower = locale.toLowerCase();
            if (normalizedLocales.has(localeLower)) {
                duplicateLocales.add(locale);
            }
            normalizedLocales.add(localeLower);
        });
        if (duplicateLocales.size > 0) {
            throw Object.defineProperty(new Error(`Specified i18n.locales contains the following duplicate locales:\n` + `${[
                ...duplicateLocales
            ].join(', ')}\n` + `Each locale should be listed only once.\n` + `See more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E471",
                enumerable: false,
                configurable: true
            });
        }
        // make sure default Locale is at the front
        i18n.locales = [
            i18n.defaultLocale,
            ...i18n.locales.filter((locale)=>locale !== i18n.defaultLocale)
        ];
        const localeDetectionType = typeof i18n.localeDetection;
        if (localeDetectionType !== 'boolean' && localeDetectionType !== 'undefined') {
            throw Object.defineProperty(new Error(`Specified i18n.localeDetection should be undefined or a boolean received ${localeDetectionType}.\nSee more info here: https://nextjs.org/docs/messages/invalid-i18n-config`), "__NEXT_ERROR_CODE", {
                value: "E439",
                enumerable: false,
                configurable: true
            });
        }
    }
    if (result.devIndicators !== false && ((_result_devIndicators = result.devIndicators) == null ? void 0 : _result_devIndicators.position)) {
        const { position } = result.devIndicators;
        const allowedValues = [
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right'
        ];
        if (!allowedValues.includes(position)) {
            throw Object.defineProperty(new Error(`Invalid "devIndicator.position" provided, expected one of ${allowedValues.join(', ')}, received ${position}`), "__NEXT_ERROR_CODE", {
                value: "E643",
                enumerable: false,
                configurable: true
            });
        }
    }
    if (result.cacheLife) {
        var _defaultConfig_cacheLife, _defaultConfig_experimental_staleTimes, _defaultConfig_experimental;
        result.cacheLife = {
            ..._configshared.defaultConfig.cacheLife,
            ...result.cacheLife
        };
        const defaultDefault = (_defaultConfig_cacheLife = _configshared.defaultConfig.cacheLife) == null ? void 0 : _defaultConfig_cacheLife['default'];
        if (!defaultDefault || defaultDefault.revalidate === undefined || defaultDefault.expire === undefined || !((_defaultConfig_experimental = _configshared.defaultConfig.experimental) == null ? void 0 : (_defaultConfig_experimental_staleTimes = _defaultConfig_experimental.staleTimes) == null ? void 0 : _defaultConfig_experimental_staleTimes.static)) {
            throw Object.defineProperty(new Error('No default cacheLife profile.'), "__NEXT_ERROR_CODE", {
                value: "E350",
                enumerable: false,
                configurable: true
            });
        }
        const defaultCacheLifeProfile = result.cacheLife['default'];
        if (!defaultCacheLifeProfile) {
            result.cacheLife['default'] = defaultDefault;
        } else {
            if (defaultCacheLifeProfile.stale === undefined) {
                var _result_experimental_staleTimes, _defaultConfig_experimental_staleTimes1, _defaultConfig_experimental1;
                const staticStaleTime = (_result_experimental_staleTimes = result.experimental.staleTimes) == null ? void 0 : _result_experimental_staleTimes.static;
                defaultCacheLifeProfile.stale = staticStaleTime ?? ((_defaultConfig_experimental1 = _configshared.defaultConfig.experimental) == null ? void 0 : (_defaultConfig_experimental_staleTimes1 = _defaultConfig_experimental1.staleTimes) == null ? void 0 : _defaultConfig_experimental_staleTimes1.static);
            }
            if (defaultCacheLifeProfile.revalidate === undefined) {
                defaultCacheLifeProfile.revalidate = defaultDefault.revalidate;
            }
            if (defaultCacheLifeProfile.expire === undefined) {
                defaultCacheLifeProfile.expire = result.expireTime ?? defaultDefault.expire;
            }
        }
    }
    if (result.cacheHandlers) {
        const allowedHandlerNameRegex = /[a-z-]/;
        if (typeof result.cacheHandlers !== 'object') {
            throw Object.defineProperty(new Error(`Invalid "cacheHandlers" provided, expected an object e.g. { default: '/my-handler.js' }, received ${JSON.stringify(result.cacheHandlers)}`), "__NEXT_ERROR_CODE", {
                value: "E901",
                enumerable: false,
                configurable: true
            });
        }
        const handlerKeys = Object.keys(result.cacheHandlers);
        const invalidHandlerItems = [];
        for (const key of handlerKeys){
            if (key === 'private') {
                invalidHandlerItems.push({
                    key,
                    reason: 'The cache handler for "use cache: private" cannot be customized.'
                });
            } else if (!allowedHandlerNameRegex.test(key)) {
                invalidHandlerItems.push({
                    key,
                    reason: 'key must only use characters a-z and -'
                });
            } else {
                const handlerPath = result.cacheHandlers[key];
                if (handlerPath && !(0, _fs.existsSync)(handlerPath)) {
                    invalidHandlerItems.push({
                        key,
                        reason: `cache handler path provided does not exist, received ${handlerPath}`
                    });
                }
            }
            if (invalidHandlerItems.length) {
                throw Object.defineProperty(new Error(`Invalid handler fields configured for "cacheHandlers":\n${invalidHandlerItems.map((item)=>`${key}: ${item.reason}`).join('\n')}`), "__NEXT_ERROR_CODE", {
                    value: "E902",
                    enumerable: false,
                    configurable: true
                });
            }
        }
    }
    const userProvidedModularizeImports = result.modularizeImports;
    // Unfortunately these packages end up re-exporting 10600 modules, for example: https://unpkg.com/browse/@mui/icons-material@5.11.16/esm/index.js.
    // Leveraging modularizeImports tremendously reduces compile times for these.
    result.modularizeImports = {
        ...userProvidedModularizeImports || {},
        // This is intentionally added after the user-provided modularizeImports config.
        '@mui/icons-material': {
            transform: '@mui/icons-material/{{member}}'
        },
        lodash: {
            transform: 'lodash/{{member}}'
        }
    };
    const userProvidedOptimizePackageImports = ((_result_experimental4 = result.experimental) == null ? void 0 : _result_experimental4.optimizePackageImports) || [];
    result.experimental.optimizePackageImports = [
        ...new Set([
            ...userProvidedOptimizePackageImports,
            'lucide-react',
            'date-fns',
            'lodash-es',
            'ramda',
            'antd',
            'react-bootstrap',
            'ahooks',
            '@ant-design/icons',
            '@headlessui/react',
            '@headlessui-float/react',
            '@heroicons/react/20/solid',
            '@heroicons/react/24/solid',
            '@heroicons/react/24/outline',
            '@visx/visx',
            '@tremor/react',
            'rxjs',
            '@mui/material',
            '@mui/icons-material',
            'recharts',
            'react-use',
            'effect',
            '@effect/schema',
            '@effect/platform',
            '@effect/platform-node',
            '@effect/platform-browser',
            '@effect/platform-bun',
            '@effect/sql',
            '@effect/sql-mssql',
            '@effect/sql-mysql2',
            '@effect/sql-pg',
            '@effect/sql-sqlite-node',
            '@effect/sql-sqlite-bun',
            '@effect/sql-sqlite-wasm',
            '@effect/sql-sqlite-react-native',
            '@effect/rpc',
            '@effect/rpc-http',
            '@effect/typeclass',
            '@effect/experimental',
            '@effect/opentelemetry',
            '@material-ui/core',
            '@material-ui/icons',
            '@tabler/icons-react',
            'mui-core',
            // We don't support wildcard imports for these configs, e.g. `react-icons/*`
            // so we need to add them manually.
            // In the future, we should consider automatically detecting packages that
            // need to be optimized.
            'react-icons/ai',
            'react-icons/bi',
            'react-icons/bs',
            'react-icons/cg',
            'react-icons/ci',
            'react-icons/di',
            'react-icons/fa',
            'react-icons/fa6',
            'react-icons/fc',
            'react-icons/fi',
            'react-icons/gi',
            'react-icons/go',
            'react-icons/gr',
            'react-icons/hi',
            'react-icons/hi2',
            'react-icons/im',
            'react-icons/io',
            'react-icons/io5',
            'react-icons/lia',
            'react-icons/lib',
            'react-icons/lu',
            'react-icons/md',
            'react-icons/pi',
            'react-icons/ri',
            'react-icons/rx',
            'react-icons/si',
            'react-icons/sl',
            'react-icons/tb',
            'react-icons/tfi',
            'react-icons/ti',
            'react-icons/vsc',
            'react-icons/wi'
        ])
    ];
    if (!result.htmlLimitedBots) {
        // @ts-expect-error: override the htmlLimitedBots with default string, type covert: RegExp -> string
        result.htmlLimitedBots = _isbot.HTML_LIMITED_BOT_UA_RE_STRING;
    }
    if (typeof result.experimental.mcpServer === 'undefined' && process.env.__NEXT_EXPERIMENTAL_MCP_SERVER === 'true') {
        result.experimental.mcpServer = true;
    }
    if (result.cacheComponents) {
        // TODO: remove once we've finished migrating internally to cacheComponents.
        result.experimental.ppr = true;
        // Prerender sourcemaps are enabled by default when using cacheComponents, unless explicitly disabled.
        if (result.enablePrerenderSourceMaps === undefined) {
            result.enablePrerenderSourceMaps = true;
        }
    }
    // "use cache" was originally implicitly enabled with the cacheComponents flag, so
    // we transfer the value for cacheComponents to the explicit useCache flag to ensure
    // backwards compatibility.
    if (result.experimental.useCache === undefined) {
        result.experimental.useCache = result.cacheComponents;
    }
    // Store the distDirRoot in the config before it is modified for development mode
    ;
    result.distDirRoot = result.distDir;
    if (phase === _constants.PHASE_DEVELOPMENT_SERVER) {
        result.distDir = (0, _path.join)(result.distDir, 'dev');
    }
    return result;
}
async function applyModifyConfig(config, phase, silent) {
    // we always call modify config  and phase can be used to only
    // modify for specific times
    if (config.adapterPath) {
        const adapterMod = (0, _interopdefault.interopDefault)(await import((0, _url.pathToFileURL)(require.resolve(config.adapterPath)).href));
        if (typeof adapterMod.modifyConfig === 'function') {
            if (!silent) {
                _log.info(`Applying modifyConfig from ${adapterMod.name}`);
            }
            config = await adapterMod.modifyConfig(config, {
                phase,
                nextVersion: "16.2.1"
            });
        }
    }
    return config;
}
// Cache config with keys to handle multiple configurations (e.g., multi-zone)
const configCache = new Map();
// Generate cache key based on parameters that affect config output
// We need a unique key for cache because there can be multiple values
function getCacheKey(phase, dir, customConfig, reactProductionProfiling, debugPrerender, pid) {
    // The next.config.js is unique per project, so we can use the dir as the major key
    // to generate the unique config key. Include PID to invalidate on server restart.
    const keyData = JSON.stringify({
        dir,
        phase,
        hasCustomConfig: Boolean(customConfig),
        reactProductionProfiling: Boolean(reactProductionProfiling),
        debugPrerender: Boolean(debugPrerender),
        pid: pid || 0
    });
    return (0, _hash.djb2Hash)(keyData).toString(36);
}
async function loadConfig(phase, dir, { customConfig, rawConfig, silent = true, reportExperimentalFeatures, reactProductionProfiling, debugPrerender, bundler } = {}) {
    // Generate cache key based on parameters that affect config output
    // Include process.pid to invalidate cache on server restart
    const cacheKey = getCacheKey(phase, dir, customConfig, reactProductionProfiling, debugPrerender, process.pid);
    // Check if we have a cached result
    const cachedResult = configCache.get(cacheKey);
    if (cachedResult) {
        // Call the experimental features callback if provided
        if (reportExperimentalFeatures) {
            reportExperimentalFeatures(cachedResult.configuredExperimentalFeatures);
        }
        // Return raw config if requested and available
        if (rawConfig && cachedResult.rawConfig) {
            return cachedResult.rawConfig;
        }
        return cachedResult.config;
    } else {
        // Reset next.config errors before loading config
        // This happens on every config load to ensure fresh validation
        _nextinstanceerrorstate.NextInstanceErrorState.nextConfig = [];
    }
    // Original implementation continues below...
    if (!process.env.__NEXT_PRIVATE_RENDER_WORKER) {
        try {
            (0, _configutils.loadWebpackHook)();
        } catch (err) {
            // this can fail in standalone mode as the files
            // aren't traced/included
            if (!process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
                throw err;
            }
        }
    }
    if (process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
        // we don't apply assignDefaults or modifyConfig here as it
        // has already been applied
        const standaloneConfig = JSON.parse(process.env.__NEXT_PRIVATE_STANDALONE_CONFIG);
        // Cache the standalone config
        configCache.set(cacheKey, {
            config: standaloneConfig,
            rawConfig: standaloneConfig,
            configuredExperimentalFeatures: []
        });
        return standaloneConfig;
    }
    const curLog = silent ? {
        warn: ()=>{},
        info: ()=>{},
        error: ()=>{}
    } : _log;
    (0, _env.loadEnvConfig)(dir, phase === _constants.PHASE_DEVELOPMENT_SERVER, curLog);
    let configFileName = 'next.config.js';
    const configuredExperimentalFeatures = [];
    if (customConfig) {
        // Check deprecation warnings on the custom config before merging with defaults
        checkDeprecations(customConfig, configFileName, silent, dir);
        const config = await applyModifyConfig(assignDefaultsAndValidate(dir, {
            configOrigin: 'server',
            configFileName,
            ...customConfig
        }, silent, phase), phase, silent);
        // Cache the custom config result
        configCache.set(cacheKey, {
            config,
            rawConfig: customConfig,
            configuredExperimentalFeatures
        });
        reportExperimentalFeatures == null ? void 0 : reportExperimentalFeatures(configuredExperimentalFeatures);
        return config;
    }
    const path = await (0, _findup.default)(_constants.CONFIG_FILES, {
        cwd: dir
    });
    // If config file was found
    if (path == null ? void 0 : path.length) {
        var _userConfig_experimental, _userConfig_experimental1, _userConfig_experimental2, _userConfig_experimental3;
        configFileName = (0, _path.basename)(path);
        let userConfigModule;
        try {
            const envBefore = Object.assign({}, process.env);
            // `import()` expects url-encoded strings, so the path must be properly
            // escaped and (especially on Windows) absolute paths must pe prefixed
            // with the `file://` protocol
            if (process.env.__NEXT_TEST_MODE === 'jest') {
                // dynamic import does not currently work inside of vm which
                // jest relies on so we fall back to require for this case
                // https://github.com/nodejs/node/issues/35889
                userConfigModule = require(path);
            } else if (configFileName === 'next.config.ts') {
                userConfigModule = await (0, _transpileconfig.transpileConfig)({
                    nextConfigPath: path,
                    dir
                });
            } else {
                userConfigModule = await import((0, _url.pathToFileURL)(path).href);
            }
            const newEnv = {};
            for (const key of Object.keys(process.env)){
                if (envBefore[key] !== process.env[key]) {
                    newEnv[key] = process.env[key];
                }
            }
            (0, _env.updateInitialEnv)(newEnv);
            if (rawConfig) {
                // Cache the raw config
                configCache.set(cacheKey, {
                    config: userConfigModule,
                    rawConfig: userConfigModule,
                    configuredExperimentalFeatures
                });
                reportExperimentalFeatures == null ? void 0 : reportExperimentalFeatures(configuredExperimentalFeatures);
                return userConfigModule;
            }
        } catch (err) {
            // Capture the error for MCP tool reporting
            _nextinstanceerrorstate.NextInstanceErrorState.nextConfig.push(err);
            // TODO: Modify docs to add cases of failing next.config.ts transformation
            curLog.error(`Failed to load ${configFileName}, see more info here https://nextjs.org/docs/messages/next-config-error`);
            throw err;
        }
        const loadedConfig = Object.freeze(await (0, _configshared.normalizeConfig)(phase, (0, _interopdefault.interopDefault)(userConfigModule)));
        if (loadedConfig.experimental) {
            for (const name of Object.keys(loadedConfig.experimental)){
                const value = loadedConfig.experimental[name];
                if (name.startsWith('turbopack') && !process.env.TURBOPACK) {
                    continue;
                }
                addConfiguredExperimentalFeature(configuredExperimentalFeatures, name, value);
            }
        }
        // Clone a new userConfig each time to avoid mutating the original
        const userConfig = cloneObject(loadedConfig);
        // Check deprecation warnings on the actual user config before merging with defaults
        checkDeprecations(userConfig, configFileName, silent, dir);
        // Always validate the config against schema in non minimal mode
        if (!process.env.NEXT_MINIMAL && !silent) {
            await validateConfigSchema(userConfig, configFileName, curLog.warn, (messages)=>{
                // Capture validation messages for MCP error reporting
                if (messages.length > 0) {
                    const fullMessage = messages.join('\n');
                    _nextinstanceerrorstate.NextInstanceErrorState.nextConfig.push(Object.defineProperty(new Error(fullMessage), "__NEXT_ERROR_CODE", {
                        value: "E394",
                        enumerable: false,
                        configurable: true
                    }));
                }
            });
        }
        if (userConfig.target && userConfig.target !== 'server') {
            throw Object.defineProperty(new Error(`The "target" property is no longer supported in ${configFileName}.\n` + 'See more info here https://nextjs.org/docs/messages/deprecated-target-config'), "__NEXT_ERROR_CODE", {
                value: "E1029",
                enumerable: false,
                configurable: true
            });
        }
        if (phase === _constants.PHASE_PRODUCTION_BUILD && bundler !== _bundler.Bundler.Turbopack && ((_userConfig_experimental = userConfig.experimental) == null ? void 0 : _userConfig_experimental.immutableAssetToken)) {
            // Silently ignore that flag for Webpack/Rspack since the server code assumes that all files
            // in `static/chunks` are always immutable without checking the manifest.
            userConfig.experimental.immutableAssetToken = undefined;
        }
        if (reactProductionProfiling) {
            userConfig.reactProductionProfiling = reactProductionProfiling;
        }
        if (((_userConfig_experimental1 = userConfig.experimental) == null ? void 0 : _userConfig_experimental1.lightningCssFeatures) && !((_userConfig_experimental2 = userConfig.experimental) == null ? void 0 : _userConfig_experimental2.useLightningcss) && bundler !== _bundler.Bundler.Turbopack) {
            curLog.warn(`experimental.lightningCssFeatures is set but experimental.useLightningcss is not enabled. ` + `The lightningCssFeatures option has no effect without useLightningcss.`);
        }
        if ((_userConfig_experimental3 = userConfig.experimental) == null ? void 0 : _userConfig_experimental3.useLightningcss) {
            var _css, _this, _userConfig_experimental4;
            const { loadBindings } = require('../build/swc');
            const isLightningSupported = (_this = await loadBindings((_userConfig_experimental4 = userConfig.experimental) == null ? void 0 : _userConfig_experimental4.useWasmBinary)) == null ? void 0 : (_css = _this.css) == null ? void 0 : _css.lightning;
            if (!isLightningSupported) {
                curLog.warn(`experimental.useLightningcss is set, but the setting is disabled because next-swc/wasm does not support it yet.`);
                userConfig.experimental.useLightningcss = false;
            }
        }
        // serialize the regex config into string
        if ((userConfig == null ? void 0 : userConfig.htmlLimitedBots) instanceof RegExp) {
            // @ts-expect-error: override the htmlLimitedBots with default string, type covert: RegExp -> string
            userConfig.htmlLimitedBots = userConfig.htmlLimitedBots.source;
        }
        enforceExperimentalFeatures(userConfig, {
            isDefaultConfig: false,
            configuredExperimentalFeatures,
            debugPrerender,
            phase
        });
        const completeConfig = assignDefaultsAndValidate(dir, {
            configOrigin: (0, _path.relative)(dir, path),
            configFile: path,
            configFileName,
            ...userConfig
        }, silent, phase);
        const finalConfig = await applyModifyConfig(completeConfig, phase, silent);
        // Cache the final result
        configCache.set(cacheKey, {
            config: finalConfig,
            rawConfig: userConfigModule,
            configuredExperimentalFeatures
        });
        if (reportExperimentalFeatures) {
            reportExperimentalFeatures(configuredExperimentalFeatures);
        }
        return finalConfig;
    } else {
        const configBaseName = (0, _path.basename)(_constants.CONFIG_FILES[0], (0, _path.extname)(_constants.CONFIG_FILES[0]));
        const unsupportedConfig = _findup.default.sync([
            `${configBaseName}.cjs`,
            `${configBaseName}.cts`,
            // TODO: Remove `as any` once we bump @types/node to v22.10.0+
            ...process.features.typescript ? [] : [
                'next.config.mts'
            ],
            `${configBaseName}.json`,
            `${configBaseName}.jsx`,
            `${configBaseName}.tsx`
        ], {
            cwd: dir
        });
        if (unsupportedConfig == null ? void 0 : unsupportedConfig.length) {
            throw Object.defineProperty(new Error(`Configuring Next.js via '${(0, _path.basename)(unsupportedConfig)}' is not supported. Please replace the file with 'next.config.js', 'next.config.mjs', or 'next.config.ts'.`), "__NEXT_ERROR_CODE", {
                value: "E203",
                enumerable: false,
                configurable: true
            });
        }
    }
    const clonedDefaultConfig = cloneObject(_configshared.defaultConfig);
    enforceExperimentalFeatures(clonedDefaultConfig, {
        isDefaultConfig: true,
        configuredExperimentalFeatures,
        debugPrerender,
        phase
    });
    // always call assignDefaults to ensure settings like
    // reactRoot can be updated correctly even with no next.config.js
    const completeConfig = assignDefaultsAndValidate(dir, {
        ...clonedDefaultConfig,
        configFileName
    }, silent, phase);
    (0, _setuphttpagentenv.setHttpClientAndAgentOptions)(completeConfig);
    const finalConfig = await applyModifyConfig(completeConfig, phase, silent);
    // Cache the default config result
    configCache.set(cacheKey, {
        config: finalConfig,
        rawConfig: clonedDefaultConfig,
        configuredExperimentalFeatures
    });
    if (reportExperimentalFeatures) {
        reportExperimentalFeatures(configuredExperimentalFeatures);
    }
    return finalConfig;
}
function enforceExperimentalFeatures(config, options) {
    const { configuredExperimentalFeatures, debugPrerender, isDefaultConfig, phase } = options;
    config.experimental ??= {};
    if (debugPrerender && (phase === _constants.PHASE_PRODUCTION_BUILD || phase === _constants.PHASE_EXPORT)) {
        // TODO: This is not an experimental feature, but should be enabled alongside other prerender debugging features.
        config.enablePrerenderSourceMaps = true;
        setExperimentalFeatureForDebugPrerender(config.experimental, 'serverSourceMaps', true, configuredExperimentalFeatures);
        setExperimentalFeatureForDebugPrerender(config.experimental, process.env.TURBOPACK ? 'turbopackMinify' : 'serverMinification', false, configuredExperimentalFeatures);
        setExperimentalFeatureForDebugPrerender(config.experimental, 'prerenderEarlyExit', false, configuredExperimentalFeatures);
        setExperimentalFeatureForDebugPrerender(config.experimental, 'allowDevelopmentBuild', true, configuredExperimentalFeatures);
    }
    // TODO: Remove this once we've made Cache Components the default.
    if (process.env.__NEXT_CACHE_COMPONENTS === 'true' && // We do respect an explicit value in the user config.
    (config.cacheComponents === undefined || isDefaultConfig && !config.cacheComponents)) {
        config.cacheComponents = true;
    }
    // TODO: Remove this once cachedNavigations is the default.
    if (process.env.__NEXT_EXPERIMENTAL_CACHED_NAVIGATIONS === 'true' && // We do respect an explicit value in the user config.
    (config.experimental.cachedNavigations === undefined || isDefaultConfig && !config.experimental.cachedNavigations)) {
        config.experimental.cachedNavigations = true;
        if (configuredExperimentalFeatures) {
            addConfiguredExperimentalFeature(configuredExperimentalFeatures, 'cachedNavigations', true, 'enabled by `__NEXT_EXPERIMENTAL_CACHED_NAVIGATIONS`');
        }
    }
    // TODO: Remove this once appNewScrollHandler is the default.
    if (process.env.__NEXT_EXPERIMENTAL_APP_NEW_SCROLL_HANDLER === 'true' && // We do respect an explicit value in the user config.
    (config.experimental.appNewScrollHandler === undefined || isDefaultConfig && !config.experimental.appNewScrollHandler)) {
        config.experimental.appNewScrollHandler = true;
        if (configuredExperimentalFeatures) {
            addConfiguredExperimentalFeature(configuredExperimentalFeatures, 'appNewScrollHandler', true, 'enabled by `__NEXT_EXPERIMENTAL_APP_NEW_SCROLL_HANDLER`');
        }
    }
    // TODO: Remove this once strictRouteTypes is the default.
    if (process.env.__NEXT_EXPERIMENTAL_STRICT_ROUTE_TYPES === 'true' && // We do respect an explicit value in the user config.
    (config.experimental.strictRouteTypes === undefined || isDefaultConfig && !config.experimental.strictRouteTypes)) {
        config.experimental.strictRouteTypes = true;
        if (configuredExperimentalFeatures) {
            addConfiguredExperimentalFeature(configuredExperimentalFeatures, 'strictRouteTypes', true, 'enabled by `__NEXT_EXPERIMENTAL_STRICT_ROUTE_TYPES`');
        }
    }
    if (process.env.__NEXT_EXPERIMENTAL_TRANSITION_INDICATOR === 'true' && // We do respect an explicit value in the user config.
    (config.experimental.transitionIndicator === undefined || isDefaultConfig && !config.experimental.transitionIndicator)) {
        config.experimental.transitionIndicator = true;
        if (configuredExperimentalFeatures) {
            addConfiguredExperimentalFeature(configuredExperimentalFeatures, 'transitionIndicator', true, 'enabled by `__NEXT_EXPERIMENTAL_TRANSITION_INDICATOR`');
        }
    }
    if (process.env.__NEXT_ENABLE_REACT_COMPILER === 'true' && // We do respect an explicit value in the user config.
    (config.reactCompiler === undefined || isDefaultConfig && !config.reactCompiler)) {
        config.reactCompiler = true;
    // TODO: Report if we enable non-experimental features via env
    }
}
function addConfiguredExperimentalFeature(configuredExperimentalFeatures, key, value, reason) {
    if (value !== _configshared.defaultConfig.experimental[key]) {
        configuredExperimentalFeatures.push({
            key,
            value,
            reason
        });
    }
}
function setExperimentalFeatureForDebugPrerender(experimentalConfig, key, value, configuredExperimentalFeatures) {
    if (experimentalConfig[key] !== value) {
        experimentalConfig[key] = value;
        if (configuredExperimentalFeatures) {
            const action = value === true ? 'enabled' : value === false ? 'disabled' : 'set';
            const reason = `${action} by \`--debug-prerender\``;
            addConfiguredExperimentalFeature(configuredExperimentalFeatures, key, value, reason);
        }
    }
}
function cloneObject(obj) {
    // Primitives & null
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    // RegExp → clone via constructor
    if (obj instanceof RegExp) {
        return new RegExp(obj.source, obj.flags);
    }
    // Function → just reuse the function reference
    if (typeof obj === 'function') {
        return obj;
    }
    // Arrays → map each element
    if (Array.isArray(obj)) {
        return obj.map(cloneObject);
    }
    // Detect non‑plain objects (class instances)
    const proto = Object.getPrototypeOf(obj);
    const isPlainObject = proto === Object.prototype || proto === null;
    // If it's not a plain object, just return the original
    if (!isPlainObject) {
        return obj;
    }
    // Plain object → create a new object with the same prototype
    // and copy all properties, cloning data properties and keeping
    // accessor properties (getters/setters) as‑is.
    const result = Object.create(proto);
    for (const key of Reflect.ownKeys(obj)){
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        if (descriptor && (descriptor.get || descriptor.set)) {
            // Accessor property → copy descriptor as‑is (get/set functions)
            Object.defineProperty(result, key, descriptor);
        } else {
            // Data property → clone the value
            result[key] = cloneObject(obj[key]);
        }
    }
    return result;
}
async function validateConfigSchema(userConfig, configFileName, warn, onValidationMessages) {
    // We only validate the config against schema in non minimal mode
    const { configSchema } = require('./config-schema');
    const state = configSchema.safeParse(userConfig);
    if (!state.success) {
        const [warnings, fatalErrors] = normalizeNextConfigZodErrors(state.error);
        const hasFatalErrors = fatalErrors.length > 0;
        // Group warnings first
        if (warnings.length > 0) {
            const warningMessages = [
                `Invalid ${configFileName} options detected: `
            ];
            for (const error of warnings){
                warningMessages.push(`    ${error.split('\n').join('\n    ')}`);
            }
            warningMessages.push('See more info here: https://nextjs.org/docs/messages/invalid-next-config');
            // Call the callback with validation messages if provided
            if (onValidationMessages) {
                onValidationMessages(warningMessages);
            }
            for (const message of warningMessages){
                warn(message);
            }
        }
        // Then throw hard errors
        if (hasFatalErrors) {
            await (0, _flushtelemetry.flushTelemetry)();
            const errorMessages = [
                `Fatal next config errors found in ${configFileName} that must be fixed:`
            ];
            for (const error of fatalErrors){
                errorMessages.push(`    ${error.split('\n').join('\n    ')}`);
            }
            errorMessages.push('These configuration options are required or have been migrated. Please update your configuration.');
            errorMessages.push('See more info here: https://nextjs.org/docs/messages/invalid-next-config');
            // Call the callback with validation messages if provided
            if (onValidationMessages) {
                onValidationMessages(errorMessages);
            }
            const fullErrorMessage = errorMessages.join('\n');
            throw Object.defineProperty(new Error(fullErrorMessage), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
    }
}

//# sourceMappingURL=config.js.map