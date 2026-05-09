"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getAppPageStaticInfo: null,
    getMiddlewareMatchers: null,
    getPageStaticInfo: null,
    getPagesPageStaticInfo: null,
    getRSCModuleInformation: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getAppPageStaticInfo: function() {
        return getAppPageStaticInfo;
    },
    getMiddlewareMatchers: function() {
        return getMiddlewareMatchers;
    },
    getPageStaticInfo: function() {
        return getPageStaticInfo;
    },
    getPagesPageStaticInfo: function() {
        return getPagesPageStaticInfo;
    },
    getRSCModuleInformation: function() {
        return getRSCModuleInformation;
    }
});
const _fs = require("fs");
const _path = require("path");
const _lrucache = require("../../server/lib/lru-cache");
const _extractconstvalue = require("./extract-const-value");
const _parsemodule = require("./parse-module");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../output/log"));
const _constants = require("../../lib/constants");
const _trytoparsepath = require("../../lib/try-to-parse-path");
const _isapiroute = require("../../lib/is-api-route");
const _isedgeruntime = require("../../lib/is-edge-runtime");
const _constants1 = require("../../shared/lib/constants");
const _pagetypes = require("../../lib/page-types");
const _appsegmentconfig = require("../segment-config/app/app-segment-config");
const _zod = require("../../shared/lib/zod");
const _pagessegmentconfig = require("../segment-config/pages/pages-segment-config");
const _middlewareconfig = require("../segment-config/middleware/middleware-config");
const _apppaths = require("../../shared/lib/router/utils/app-paths");
const _normalizepagepath = require("../../shared/lib/page-path/normalize-page-path");
const _utils = require("../utils");
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
const PARSE_PATTERN = /(?<!(_jsx|jsx-))runtime|preferredRegion|getStaticProps|getServerSideProps|generateStaticParams|export const|generateImageMetadata|generateSitemaps|middleware|proxy/;
const CLIENT_MODULE_LABEL = /\/\* __next_internal_client_entry_do_not_use__ ([^ ]*) (cjs|auto) \*\//;
// Match JSON object that may contain nested objects (for loc info)
// The JSON ends right before the closing " */"
const ACTION_MODULE_LABEL = /\/\* __next_internal_action_entry_do_not_use__ (\{.*\}) \*\//;
const CLIENT_DIRECTIVE = 'use client';
const SERVER_ACTION_DIRECTIVE = 'use server';
function getRSCModuleInformation(source, isReactServerLayer) {
    const actionsJson = source.match(ACTION_MODULE_LABEL);
    // Parse action metadata - supports both old format (string) and new format (object with loc)
    const parsedActionsMeta = actionsJson ? JSON.parse(actionsJson[1]) : undefined;
    const clientInfoMatch = source.match(CLIENT_MODULE_LABEL);
    const isClientRef = !!clientInfoMatch;
    if (!isReactServerLayer) {
        return {
            type: _constants1.RSC_MODULE_TYPES.client,
            actionIds: parsedActionsMeta,
            isClientRef
        };
    }
    const clientRefsString = clientInfoMatch == null ? void 0 : clientInfoMatch[1];
    const clientRefs = clientRefsString ? clientRefsString.split(',') : [];
    const clientEntryType = clientInfoMatch == null ? void 0 : clientInfoMatch[2];
    const type = clientInfoMatch ? _constants1.RSC_MODULE_TYPES.client : _constants1.RSC_MODULE_TYPES.server;
    return {
        type,
        actionIds: parsedActionsMeta,
        clientRefs,
        clientEntryType,
        isClientRef
    };
}
/**
 * Receives a parsed AST from SWC and checks if it belongs to a module that
 * requires a runtime to be specified. Those are:
 *   - Modules with `export function getStaticProps | getServerSideProps`
 *   - Modules with `export { getStaticProps | getServerSideProps } <from ...>`
 *   - Modules with `export const runtime = ...`
 */ function checkExports(ast, expectedExports, page) {
    const exportsSet = new Set([
        'getStaticProps',
        'getServerSideProps',
        'generateImageMetadata',
        'generateSitemaps',
        'generateStaticParams'
    ]);
    if (!Array.isArray(ast == null ? void 0 : ast.body)) {
        return {};
    }
    try {
        let getStaticProps = false;
        let getServerSideProps = false;
        let generateImageMetadata = false;
        let generateSitemaps = false;
        let generateStaticParams = false;
        let exports1 = new Set();
        let directives = new Set();
        let hasLeadingNonDirectiveNode = false;
        for (const node of ast.body){
            var _node_declaration, _node_declaration1, _node_declaration_identifier, _node_declaration2;
            // There should be no non-string literals nodes before directives
            if (node.type === 'ExpressionStatement' && node.expression.type === 'StringLiteral') {
                if (!hasLeadingNonDirectiveNode) {
                    const directive = node.expression.value;
                    if (CLIENT_DIRECTIVE === directive) {
                        directives.add('client');
                    }
                    if (SERVER_ACTION_DIRECTIVE === directive) {
                        directives.add('server');
                    }
                }
            } else {
                hasLeadingNonDirectiveNode = true;
            }
            if (node.type === 'ExportDeclaration' && ((_node_declaration = node.declaration) == null ? void 0 : _node_declaration.type) === 'VariableDeclaration') {
                var _node_declaration3;
                for (const declaration of (_node_declaration3 = node.declaration) == null ? void 0 : _node_declaration3.declarations){
                    if (expectedExports.includes(declaration.id.value)) {
                        exports1.add(declaration.id.value);
                    }
                }
            }
            if (node.type === 'ExportDeclaration' && ((_node_declaration1 = node.declaration) == null ? void 0 : _node_declaration1.type) === 'FunctionDeclaration' && exportsSet.has((_node_declaration_identifier = node.declaration.identifier) == null ? void 0 : _node_declaration_identifier.value)) {
                const id = node.declaration.identifier.value;
                getServerSideProps = id === 'getServerSideProps';
                getStaticProps = id === 'getStaticProps';
                generateImageMetadata = id === 'generateImageMetadata';
                generateSitemaps = id === 'generateSitemaps';
                generateStaticParams = id === 'generateStaticParams';
            }
            if (node.type === 'ExportDeclaration' && ((_node_declaration2 = node.declaration) == null ? void 0 : _node_declaration2.type) === 'VariableDeclaration') {
                var _node_declaration_declarations_, _node_declaration4;
                const id = (_node_declaration4 = node.declaration) == null ? void 0 : (_node_declaration_declarations_ = _node_declaration4.declarations[0]) == null ? void 0 : _node_declaration_declarations_.id.value;
                if (exportsSet.has(id)) {
                    getServerSideProps = id === 'getServerSideProps';
                    getStaticProps = id === 'getStaticProps';
                    generateImageMetadata = id === 'generateImageMetadata';
                    generateSitemaps = id === 'generateSitemaps';
                    generateStaticParams = id === 'generateStaticParams';
                }
            }
            if (node.type === 'ExportNamedDeclaration') {
                for (const specifier of node.specifiers){
                    var _specifier_orig;
                    if (specifier.type === 'ExportSpecifier' && ((_specifier_orig = specifier.orig) == null ? void 0 : _specifier_orig.type) === 'Identifier') {
                        const value = specifier.orig.value;
                        if (!getServerSideProps && value === 'getServerSideProps') {
                            getServerSideProps = true;
                        }
                        if (!getStaticProps && value === 'getStaticProps') {
                            getStaticProps = true;
                        }
                        if (!generateImageMetadata && value === 'generateImageMetadata') {
                            generateImageMetadata = true;
                        }
                        if (!generateSitemaps && value === 'generateSitemaps') {
                            generateSitemaps = true;
                        }
                        if (!generateStaticParams && value === 'generateStaticParams') {
                            generateStaticParams = true;
                        }
                        if (expectedExports.includes(value) && !exports1.has(value)) {
                            // An export was found that was actually a re-export, and not a
                            // literal value. We should warn here.
                            _log.warn(`Next.js can't recognize the exported \`${value}\` field in "${page}", it may be re-exported from another file. The default config will be used instead.`);
                        }
                    }
                }
            }
        }
        return {
            getStaticProps,
            getServerSideProps,
            generateImageMetadata,
            generateSitemaps,
            generateStaticParams,
            directives,
            exports: exports1
        };
    } catch  {}
    return {};
}
function validateMiddlewareProxyExports({ ast, page, pageFilePath, isDev }) {
    // Check if this is middleware/proxy
    const isMiddleware = page === `/${_constants.MIDDLEWARE_FILENAME}` || page === `/src/${_constants.MIDDLEWARE_FILENAME}`;
    const isProxy = page === `/${_constants.PROXY_FILENAME}` || page === `/src/${_constants.PROXY_FILENAME}`;
    if (!isMiddleware && !isProxy) {
        return;
    }
    if (!ast || !Array.isArray(ast.body)) {
        return;
    }
    const fileName = isProxy ? _constants.PROXY_FILENAME : _constants.MIDDLEWARE_FILENAME;
    // Parse AST to get export info (since checkExports doesn't return middleware/proxy info)
    let hasDefaultExport = false;
    let hasMiddlewareExport = false;
    let hasProxyExport = false;
    for (const node of ast.body){
        var _node_declaration, _node_declaration1;
        if (node.type === 'ExportDefaultDeclaration' || node.type === 'ExportDefaultExpression') {
            hasDefaultExport = true;
        }
        if (node.type === 'ExportDeclaration' && ((_node_declaration = node.declaration) == null ? void 0 : _node_declaration.type) === 'FunctionDeclaration') {
            var _node_declaration_identifier;
            const id = (_node_declaration_identifier = node.declaration.identifier) == null ? void 0 : _node_declaration_identifier.value;
            if (id === 'middleware') {
                hasMiddlewareExport = true;
            }
            if (id === 'proxy') {
                hasProxyExport = true;
            }
        }
        if (node.type === 'ExportDeclaration' && ((_node_declaration1 = node.declaration) == null ? void 0 : _node_declaration1.type) === 'VariableDeclaration') {
            var _node_declaration_declarations_, _node_declaration2;
            const id = (_node_declaration2 = node.declaration) == null ? void 0 : (_node_declaration_declarations_ = _node_declaration2.declarations[0]) == null ? void 0 : _node_declaration_declarations_.id.value;
            if (id === 'middleware') {
                hasMiddlewareExport = true;
            }
            if (id === 'proxy') {
                hasProxyExport = true;
            }
        }
        if (node.type === 'ExportNamedDeclaration') {
            for (const specifier of node.specifiers){
                var _specifier_orig;
                if (specifier.type === 'ExportSpecifier' && ((_specifier_orig = specifier.orig) == null ? void 0 : _specifier_orig.type) === 'Identifier') {
                    // Use the exported name if it exists (for aliased exports like `export { foo as proxy }`),
                    // otherwise fall back to the original name (for simple re-exports like `export { proxy }`)
                    const exportedIdentifier = specifier.exported || specifier.orig;
                    const value = exportedIdentifier.value;
                    if (value === 'middleware') {
                        hasMiddlewareExport = true;
                    }
                    if (value === 'proxy') {
                        hasProxyExport = true;
                    }
                }
            }
        }
    }
    const hasValidExport = hasDefaultExport || isMiddleware && hasMiddlewareExport || isProxy && hasProxyExport;
    const relativePath = (0, _path.relative)(process.cwd(), pageFilePath);
    const resolvedPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
    if (!hasValidExport) {
        const message = `The file "${resolvedPath}" must export a function, either as a default export or as a named "${fileName}" export.\n` + `This function is what Next.js runs for every request handled by this ${fileName === 'proxy' ? 'proxy (previously called middleware)' : 'middleware'}.\n\n` + `Why this happens:\n` + (isProxy ? "- You are migrating from `middleware` to `proxy`, but haven't updated the exported function.\n" : '') + `- The file exists but doesn't export a function.\n` + `- The export is not a function (e.g., an object or constant).\n` + `- There's a syntax error preventing the export from being recognized.\n\n` + `To fix it:\n` + `- Ensure this file has either a default or "${fileName}" function export.\n\n` + `Learn more: https://nextjs.org/docs/messages/middleware-to-proxy`;
        if (isDev) {
            // errorOnce as proxy/middleware runs per request including multiple
            // internal _next/ routes and spams logs.
            _log.errorOnce(message);
        } else {
            throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                value: "E903",
                enumerable: false,
                configurable: true
            });
        }
    }
}
function tryToReadFile(filePath, shouldThrow) {
    try {
        return (0, _fs.readFileSync)(filePath, {
            encoding: 'utf8'
        });
    } catch (error) {
        if (shouldThrow) {
            error.message = `Next.js ERROR: Failed to read file ${filePath}:\n${error.message}`;
            throw error;
        }
    }
}
function getMiddlewareMatchers(matcherOrMatchers, nextConfig) {
    const matchers = Array.isArray(matcherOrMatchers) ? matcherOrMatchers : [
        matcherOrMatchers
    ];
    const { i18n } = nextConfig;
    return matchers.map((matcher)=>{
        matcher = typeof matcher === 'string' ? {
            source: matcher
        } : matcher;
        const originalSource = matcher.source;
        let { source, ...rest } = matcher;
        const isRoot = source === '/';
        if ((i18n == null ? void 0 : i18n.locales) && matcher.locale !== false) {
            source = `/:nextInternalLocale((?!_next/)[^/.]{1,})${isRoot ? '' : source}`;
        }
        source = `/:nextData(_next/data/[^/]{1,})?${source}${isRoot ? `(${nextConfig.i18n ? '|\\.json|' : ''}/?index|/?index\\.json)?` : '{(\\.json)}?'}`;
        if (nextConfig.basePath) {
            source = `${nextConfig.basePath}${source}`;
        }
        // Validate that the source is still.
        const result = _middlewareconfig.SourceSchema.safeParse(source);
        if (!result.success) {
            (0, _zod.reportZodError)('Failed to parse middleware source', result.error);
            // We need to exit here because middleware being built occurs before we
            // finish setting up the server. Exiting here is the only way to ensure
            // that we don't hang.
            process.exit(1);
        }
        return {
            ...rest,
            // We know that parsed.regexStr is not undefined because we already
            // checked that the source is valid.
            regexp: (0, _trytoparsepath.tryToParsePath)(result.data).regexStr,
            originalSource: originalSource || source
        };
    });
}
function parseMiddlewareConfig(page, rawConfig, nextConfig) {
    // If there's no config to parse, then return nothing.
    if (typeof rawConfig !== 'object' || !rawConfig) return {};
    const input = _middlewareconfig.MiddlewareConfigInputSchema.safeParse(rawConfig);
    if (!input.success) {
        (0, _zod.reportZodError)(`${page} contains invalid middleware config`, input.error);
        // We need to exit here because middleware being built occurs before we
        // finish setting up the server. Exiting here is the only way to ensure
        // that we don't hang.
        process.exit(1);
    }
    const config = {};
    if (input.data.matcher) {
        config.matchers = getMiddlewareMatchers(input.data.matcher, nextConfig);
    }
    if (input.data.unstable_allowDynamic) {
        config.unstable_allowDynamic = Array.isArray(input.data.unstable_allowDynamic) ? input.data.unstable_allowDynamic : [
            input.data.unstable_allowDynamic
        ];
    }
    if (input.data.regions) {
        config.regions = input.data.regions;
    }
    return config;
}
const apiRouteWarnings = new _lrucache.LRUCache(250);
function warnAboutExperimentalEdge(apiRoute) {
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PRIVATE_BUILD_WORKER === '1') {
        return;
    }
    if (apiRoute && apiRouteWarnings.has(apiRoute)) {
        return;
    }
    _log.warn(apiRoute ? `${apiRoute} provided runtime 'experimental-edge'. It can be updated to 'edge' instead.` : `You are using an experimental edge runtime, the API might change.`);
    if (apiRoute) {
        apiRouteWarnings.set(apiRoute, 1);
    }
}
let hadUnsupportedValue = false;
const warnedUnsupportedValueMap = new _lrucache.LRUCache(250, ()=>1);
function warnAboutUnsupportedValue(pageFilePath, page, result) {
    hadUnsupportedValue = true;
    const isProductionBuild = process.env.NODE_ENV === 'production';
    if (// we only log for the server compilation so it's not
    // duplicated due to webpack build worker having fresh
    // module scope for each compiler
    process.env.NEXT_COMPILER_NAME !== 'server' || isProductionBuild && warnedUnsupportedValueMap.has(pageFilePath)) {
        return;
    }
    warnedUnsupportedValueMap.set(pageFilePath, true);
    const message = `Next.js can't recognize the exported \`config\` field in ` + (page ? `route "${page}"` : `"${pageFilePath}"`) + ':\n' + result.unsupported + (result.path ? ` at "${result.path}"` : '') + '.\n' + 'Read More - https://nextjs.org/docs/messages/invalid-page-config';
    // for a build we use `Log.error` instead of throwing
    // so that all errors can be logged before exiting the process
    if (isProductionBuild) {
        _log.error(message);
    } else {
        throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
            value: "E1013",
            enumerable: false,
            configurable: true
        });
    }
}
async function getAppPageStaticInfo({ pageFilePath, nextConfig, isDev, page }) {
    const content = tryToReadFile(pageFilePath, !isDev);
    if (!content || !PARSE_PATTERN.test(content)) {
        return {
            type: _pagetypes.PAGE_TYPES.APP,
            config: undefined,
            runtime: undefined,
            preferredRegion: undefined,
            maxDuration: undefined,
            hadUnsupportedValue: false
        };
    }
    const ast = await (0, _parsemodule.parseModule)(pageFilePath, content);
    validateMiddlewareProxyExports({
        ast,
        page,
        pageFilePath,
        isDev
    });
    const { generateStaticParams, generateImageMetadata, generateSitemaps, exports: exports1, directives } = checkExports(ast, _appsegmentconfig.AppSegmentConfigSchemaKeys, page);
    const { type: rsc } = getRSCModuleInformation(content, true);
    const exportedConfig = {};
    if (exports1) {
        for (const property of exports1){
            const result = (0, _extractconstvalue.extractExportedConstValue)(ast, property);
            if (result !== null && 'unsupported' in result) {
                warnAboutUnsupportedValue(pageFilePath, page, result);
            } else if (result !== null) {
                exportedConfig[property] = result.value;
            }
        }
    }
    const configResult = (0, _extractconstvalue.extractExportedConstValue)(ast, 'config');
    if (configResult !== null && 'unsupported' in configResult) {
        warnAboutUnsupportedValue(pageFilePath, page, configResult);
    } else if (configResult !== null) {
        exportedConfig.config = configResult.value;
    }
    const route = (0, _apppaths.normalizeAppPath)(page);
    const config = (0, _appsegmentconfig.parseAppSegmentConfig)(exportedConfig, route);
    // Prevent edge runtime and generateStaticParams in the same file.
    if ((0, _isedgeruntime.isEdgeRuntime)(config.runtime) && generateStaticParams) {
        throw Object.defineProperty(new Error(`Page "${page}" cannot use both \`export const runtime = 'edge'\` and export \`generateStaticParams\`.`), "__NEXT_ERROR_CODE", {
            value: "E42",
            enumerable: false,
            configurable: true
        });
    }
    // Prevent use client and generateStaticParams in the same file.
    if ((directives == null ? void 0 : directives.has('client')) && generateStaticParams) {
        throw Object.defineProperty(new Error(`Page "${page}" cannot use both "use client" and export function "generateStaticParams()".`), "__NEXT_ERROR_CODE", {
            value: "E475",
            enumerable: false,
            configurable: true
        });
    }
    // Prevent use client and unstable_instant in the same file.
    if ((directives == null ? void 0 : directives.has('client')) && 'unstable_instant' in config) {
        throw Object.defineProperty(new Error(`Page "${page}" cannot export "unstable_instant" from a Client Component module. To use this API, convert this module to a Server Component by removing the "use client" directive.`), "__NEXT_ERROR_CODE", {
            value: "E1075",
            enumerable: false,
            configurable: true
        });
    }
    if ('unstable_instant' in config && !nextConfig.cacheComponents) {
        throw Object.defineProperty(new Error(`Page "${page}" cannot use \`export const unstable_instant = ...\` without enabling \`cacheComponents\`.`), "__NEXT_ERROR_CODE", {
            value: "E990",
            enumerable: false,
            configurable: true
        });
    }
    // Prevent unstable_dynamicStaleTime in layouts.
    if ('unstable_dynamicStaleTime' in config) {
        const isLayout = /\/layout\.[^/]+$/.test(pageFilePath);
        if (isLayout) {
            throw Object.defineProperty(new Error(`"${page}" cannot use \`export const unstable_dynamicStaleTime\`. This config is only supported in page files, not layouts.`), "__NEXT_ERROR_CODE", {
                value: "E1137",
                enumerable: false,
                configurable: true
            });
        }
    }
    // Prevent combining unstable_dynamicStaleTime and unstable_instant.
    if ('unstable_dynamicStaleTime' in config && 'unstable_instant' in config) {
        throw Object.defineProperty(new Error(`Page "${page}" cannot use both \`export const unstable_dynamicStaleTime\` and \`export const unstable_instant\`.`), "__NEXT_ERROR_CODE", {
            value: "E1136",
            enumerable: false,
            configurable: true
        });
    }
    return {
        type: _pagetypes.PAGE_TYPES.APP,
        rsc,
        generateImageMetadata,
        generateSitemaps,
        generateStaticParams,
        config,
        middleware: parseMiddlewareConfig(page, exportedConfig.config, nextConfig),
        runtime: config.runtime,
        preferredRegion: config.preferredRegion,
        maxDuration: config.maxDuration,
        hadUnsupportedValue
    };
}
async function getPagesPageStaticInfo({ pageFilePath, nextConfig, isDev, page }) {
    var _config_config, _config_config1, _config_config2;
    const content = tryToReadFile(pageFilePath, !isDev);
    if (!content || !PARSE_PATTERN.test(content)) {
        return {
            type: _pagetypes.PAGE_TYPES.PAGES,
            config: undefined,
            runtime: undefined,
            preferredRegion: undefined,
            maxDuration: undefined,
            hadUnsupportedValue: false
        };
    }
    const ast = await (0, _parsemodule.parseModule)(pageFilePath, content);
    validateMiddlewareProxyExports({
        ast,
        page,
        pageFilePath,
        isDev
    });
    const { getServerSideProps, getStaticProps, exports: exports1 } = checkExports(ast, _pagessegmentconfig.PagesSegmentConfigSchemaKeys, page);
    const { type: rsc } = getRSCModuleInformation(content, true);
    const exportedConfig = {};
    if (exports1) {
        for (const property of exports1){
            const result = (0, _extractconstvalue.extractExportedConstValue)(ast, property);
            if (result !== null && 'unsupported' in result) {
                warnAboutUnsupportedValue(pageFilePath, page, result);
            } else if (result !== null) {
                exportedConfig[property] = result.value;
            }
        }
    }
    const configResult = (0, _extractconstvalue.extractExportedConstValue)(ast, 'config');
    if (configResult !== null && 'unsupported' in configResult) {
        warnAboutUnsupportedValue(pageFilePath, page, configResult);
    } else if (configResult !== null) {
        exportedConfig.config = configResult.value;
    }
    // Validate the config.
    const route = (0, _normalizepagepath.normalizePagePath)(page);
    const config = (0, _pagessegmentconfig.parsePagesSegmentConfig)(exportedConfig, route);
    const isAnAPIRoute = (0, _isapiroute.isAPIRoute)(route);
    let resolvedRuntime = config.runtime ?? ((_config_config = config.config) == null ? void 0 : _config_config.runtime);
    if ((0, _utils.isProxyFile)(page) && resolvedRuntime) {
        const relativePath = (0, _path.relative)(process.cwd(), pageFilePath);
        const resolvedPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
        const message = `Route segment config is not allowed in Proxy file at "${resolvedPath}". Proxy always runs on Node.js runtime. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy`;
        if (isDev) {
            // errorOnce as proxy/middleware runs per request including multiple
            // internal _next/ routes and spams logs.
            _log.errorOnce(message);
            resolvedRuntime = _constants.SERVER_RUNTIME.nodejs;
        } else {
            throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                value: "E1031",
                enumerable: false,
                configurable: true
            });
        }
    }
    if (resolvedRuntime === _constants.SERVER_RUNTIME.experimentalEdge) {
        warnAboutExperimentalEdge(isAnAPIRoute ? page : null);
    }
    if (!(0, _utils.isProxyFile)(page) && resolvedRuntime === _constants.SERVER_RUNTIME.edge && page && !isAnAPIRoute) {
        const message = `Page ${page} provided runtime 'edge', the edge runtime for rendering is currently experimental. Use runtime 'experimental-edge' instead.`;
        if (isDev) {
            _log.error(message);
        } else {
            throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                value: "E1015",
                enumerable: false,
                configurable: true
            });
        }
    }
    return {
        type: _pagetypes.PAGE_TYPES.PAGES,
        getStaticProps,
        getServerSideProps,
        rsc,
        config,
        middleware: parseMiddlewareConfig(page, exportedConfig.config, nextConfig),
        runtime: resolvedRuntime,
        preferredRegion: (_config_config1 = config.config) == null ? void 0 : _config_config1.regions,
        maxDuration: config.maxDuration ?? ((_config_config2 = config.config) == null ? void 0 : _config_config2.maxDuration),
        hadUnsupportedValue
    };
}
async function getPageStaticInfo(params) {
    if (params.pageType === _pagetypes.PAGE_TYPES.APP) {
        return getAppPageStaticInfo(params);
    }
    return getPagesPageStaticInfo(params);
}

//# sourceMappingURL=get-page-static-info.js.map