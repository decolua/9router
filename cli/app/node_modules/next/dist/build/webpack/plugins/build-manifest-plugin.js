"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    default: null,
    generateClientManifest: null,
    getEntrypointFiles: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    // This plugin creates a build-manifest.json for all assets that are being output
    // It has a mapping of "entry" filename to real filename. Because the real filename can be hashed in production
    default: function() {
        return BuildManifestPlugin;
    },
    generateClientManifest: function() {
        return generateClientManifest;
    },
    getEntrypointFiles: function() {
        return getEntrypointFiles;
    }
});
const _devalue = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/devalue"));
const _webpack = require("next/dist/compiled/webpack/webpack");
const _constants = require("../../../shared/lib/constants");
const _getroutefromentrypoint = /*#__PURE__*/ _interop_require_default(require("../../../server/get-route-from-entrypoint"));
const _utils = require("../../../shared/lib/router/utils");
const _trace = require("../../../trace");
const _utils1 = require("../utils");
const _buildmanifestpluginutils = require("./build-manifest-plugin-utils");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function buildNodejsLowPriorityPath(filename, buildId) {
    return `${_constants.CLIENT_STATIC_FILES_PATH}/${buildId}/${filename}`;
}
function generateClientManifest(assetMap, rewrites, clientRouterFilters, compiler, compilation) {
    const compilationSpan = compilation ? (0, _utils1.getCompilationSpan)(compilation) : compiler ? (0, _utils1.getCompilationSpan)(compiler) : new _trace.Span({
        name: 'client-manifest'
    });
    const genClientManifestSpan = compilationSpan == null ? void 0 : compilationSpan.traceChild('NextJsBuildManifest-generateClientManifest');
    return genClientManifestSpan == null ? void 0 : genClientManifestSpan.traceFn(()=>{
        const clientManifest = {
            __rewrites: (0, _buildmanifestpluginutils.normalizeRewritesForBuildManifest)(rewrites),
            __routerFilterStatic: clientRouterFilters == null ? void 0 : clientRouterFilters.staticFilter,
            __routerFilterDynamic: clientRouterFilters == null ? void 0 : clientRouterFilters.dynamicFilter
        };
        const appDependencies = new Set(assetMap.pages['/_app']);
        const sortedPageKeys = (0, _utils.getSortedRoutes)(Object.keys(assetMap.pages));
        sortedPageKeys.forEach((page)=>{
            const dependencies = assetMap.pages[page];
            if (page === '/_app') return;
            // Filter out dependencies in the _app entry, because those will have already
            // been loaded by the client prior to a navigation event
            const filteredDeps = dependencies.filter((dep)=>!appDependencies.has(dep));
            // The manifest can omit the page if it has no requirements
            if (filteredDeps.length) {
                clientManifest[page] = filteredDeps;
            }
        });
        // provide the sorted pages as an array so we don't rely on the object's keys
        // being in order and we don't slow down look-up time for page assets
        clientManifest.sortedPages = sortedPageKeys;
        return (0, _devalue.default)(clientManifest);
    });
}
function getEntrypointFiles(entrypoint) {
    return (entrypoint == null ? void 0 : entrypoint.getFiles().filter((file)=>{
        // We don't want to include `.hot-update.js` files into the initial page
        return /(?<!\.hot-update)\.(js|css)($|\?)/.test(file);
    }).map((file)=>file.replace(/\\/g, '/'))) ?? [];
}
class BuildManifestPlugin {
    constructor(options){
        this.buildId = options.buildId;
        this.isDevFallback = !!options.isDevFallback;
        this.rewrites = {
            beforeFiles: [],
            afterFiles: [],
            fallback: []
        };
        this.appDirEnabled = options.appDirEnabled;
        this.clientRouterFilters = options.clientRouterFilters;
        this.rewrites.beforeFiles = options.rewrites.beforeFiles.map(_buildmanifestpluginutils.processRoute);
        this.rewrites.afterFiles = options.rewrites.afterFiles.map(_buildmanifestpluginutils.processRoute);
        this.rewrites.fallback = options.rewrites.fallback.map(_buildmanifestpluginutils.processRoute);
    }
    createAssets(compiler, compilation) {
        const compilationSpan = (0, _utils1.getCompilationSpan)(compilation) ?? (0, _utils1.getCompilationSpan)(compiler);
        if (!compilationSpan) {
            throw Object.defineProperty(new Error('No span found for compilation'), "__NEXT_ERROR_CODE", {
                value: "E646",
                enumerable: false,
                configurable: true
            });
        }
        const createAssetsSpan = compilationSpan.traceChild('NextJsBuildManifest-createassets');
        return createAssetsSpan.traceFn(()=>{
            const entrypoints = compilation.entrypoints;
            const assetMap = {
                polyfillFiles: [],
                devFiles: [],
                lowPriorityFiles: [],
                rootMainFiles: [],
                rootMainFilesTree: {},
                pages: {
                    '/_app': []
                }
            };
            const mainFiles = new Set(getEntrypointFiles(entrypoints.get(_constants.CLIENT_STATIC_FILES_RUNTIME_MAIN)));
            if (this.appDirEnabled) {
                assetMap.rootMainFiles = [
                    ...new Set(getEntrypointFiles(entrypoints.get(_constants.CLIENT_STATIC_FILES_RUNTIME_MAIN_APP)))
                ];
            }
            const compilationAssets = compilation.getAssets();
            assetMap.polyfillFiles = compilationAssets.filter((p)=>{
                // Ensure only .js files are passed through
                if (!p.name.endsWith('.js')) {
                    return false;
                }
                return p.info && _constants.CLIENT_STATIC_FILES_RUNTIME_POLYFILLS_SYMBOL in p.info;
            }).map((v)=>v.name);
            assetMap.devFiles = getEntrypointFiles(entrypoints.get(_constants.CLIENT_STATIC_FILES_RUNTIME_REACT_REFRESH)).filter((file)=>!mainFiles.has(file));
            for (const entrypoint of compilation.entrypoints.values()){
                if (_constants.SYSTEM_ENTRYPOINTS.has(entrypoint.name)) continue;
                const pagePath = (0, _getroutefromentrypoint.default)(entrypoint.name);
                if (!pagePath) {
                    continue;
                }
                const filesForPage = getEntrypointFiles(entrypoint);
                assetMap.pages[pagePath] = [
                    ...new Set([
                        ...mainFiles,
                        ...filesForPage
                    ])
                ];
            }
            if (!this.isDevFallback) {
                // Add the runtime build manifest file (generated later in this file)
                // as a dependency for the app. If the flag is false, the file won't be
                // downloaded by the client.
                const buildManifestPath = buildNodejsLowPriorityPath('_buildManifest.js', this.buildId);
                const ssgManifestPath = buildNodejsLowPriorityPath('_ssgManifest.js', this.buildId);
                assetMap.lowPriorityFiles.push(buildManifestPath, ssgManifestPath);
                compilation.emitAsset(ssgManifestPath, new _webpack.sources.RawSource(_buildmanifestpluginutils.srcEmptySsgManifest));
            }
            assetMap.pages = Object.keys(assetMap.pages).sort().reduce(// eslint-disable-next-line
            (a, c)=>(a[c] = assetMap.pages[c], a), {});
            let buildManifestName = _constants.BUILD_MANIFEST;
            if (this.isDevFallback) {
                buildManifestName = `fallback-${_constants.BUILD_MANIFEST}`;
            }
            compilation.emitAsset(buildManifestName, new _webpack.sources.RawSource(JSON.stringify(assetMap, null, 2)));
            compilation.emitAsset(`server/${_constants.MIDDLEWARE_BUILD_MANIFEST}.js`, new _webpack.sources.RawSource(`${(0, _buildmanifestpluginutils.createEdgeRuntimeManifest)(assetMap)}`));
            if (!this.isDevFallback) {
                const buildManifestPath = buildNodejsLowPriorityPath('_buildManifest.js', this.buildId);
                compilation.emitAsset(buildManifestPath, new _webpack.sources.RawSource(`self.__BUILD_MANIFEST = ${generateClientManifest(assetMap, this.rewrites, this.clientRouterFilters, compiler, compilation)};self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()`));
            }
        });
    }
    apply(compiler) {
        compiler.hooks.make.tap('NextJsBuildManifest', (compilation)=>{
            compilation.hooks.processAssets.tap({
                name: 'NextJsBuildManifest',
                stage: _webpack.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
            }, ()=>{
                this.createAssets(compiler, compilation);
            });
        });
        return;
    }
}

//# sourceMappingURL=build-manifest-plugin.js.map