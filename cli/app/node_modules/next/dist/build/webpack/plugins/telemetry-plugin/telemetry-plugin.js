"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TelemetryPlugin", {
    enumerable: true,
    get: function() {
        return TelemetryPlugin;
    }
});
const _usecachetrackerutils = require("./use-cache-tracker-utils");
// Map of a feature module to the file it belongs in the next package.
const FEATURE_MODULE_MAP = new Map([
    [
        'next/image',
        '/next/image.js'
    ],
    [
        'next/future/image',
        '/next/future/image.js'
    ],
    [
        'next/legacy/image',
        '/next/legacy/image.js'
    ],
    [
        'next/script',
        '/next/script.js'
    ],
    [
        'next/dynamic',
        '/next/dynamic.js'
    ]
]);
const FEATURE_MODULE_REGEXP_MAP = new Map([
    [
        '@next/font/google',
        /\/@next\/font\/google\/target.css?.+$/
    ],
    [
        '@next/font/local',
        /\/@next\/font\/local\/target.css?.+$/
    ],
    [
        'next/font/google',
        /\/next\/font\/google\/target.css?.+$/
    ],
    [
        'next/font/local',
        /\/next\/font\/local\/target.css?.+$/
    ]
]);
// List of build features used in webpack configuration
const BUILD_FEATURES = [
    'swcLoader',
    'swcRelay',
    'swcStyledComponents',
    'swcReactRemoveProperties',
    'swcExperimentalDecorators',
    'swcRemoveConsole',
    'swcImportSource',
    'swcEmotion',
    'swc/target/x86_64-apple-darwin',
    'swc/target/x86_64-unknown-linux-gnu',
    'swc/target/x86_64-pc-windows-msvc',
    'swc/target/i686-pc-windows-msvc',
    'swc/target/aarch64-unknown-linux-gnu',
    'swc/target/armv7-unknown-linux-gnueabihf',
    'swc/target/aarch64-apple-darwin',
    'swc/target/aarch64-linux-android',
    'swc/target/arm-linux-androideabi',
    'swc/target/x86_64-unknown-freebsd',
    'swc/target/x86_64-unknown-linux-musl',
    'swc/target/aarch64-unknown-linux-musl',
    'swc/target/aarch64-pc-windows-msvc',
    'turbotrace',
    'transpilePackages',
    'skipProxyUrlNormalize',
    'skipTrailingSlashRedirect',
    'modularizeImports',
    'esmExternals',
    'webpackPlugins'
];
const eliminatedPackages = new Set();
const useCacheTracker = (0, _usecachetrackerutils.createUseCacheTracker)();
/**
 * Determine if there is a feature of interest in the specified 'module'.
 */ function findFeatureInModule(module) {
    if (module.type !== 'javascript/auto') {
        return;
    }
    for (const [feature, path] of FEATURE_MODULE_MAP){
        var _module_resource;
        // imports like "http" will be undefined resource in rspack
        if ((_module_resource = module.resource) == null ? void 0 : _module_resource.endsWith(path)) {
            return feature;
        }
    }
    const normalizedIdentifier = module.identifier().replace(/\\/g, '/');
    for (const [feature, regexp] of FEATURE_MODULE_REGEXP_MAP){
        if (regexp.test(normalizedIdentifier)) {
            return feature;
        }
    }
}
/**
 * Find unique origin modules in the specified 'connections', which possibly
 * contains more than one connection for a module due to different types of
 * dependency.
 */ function findUniqueOriginModulesInConnections(connections, originModule) {
    const originModules = new Set();
    for (const connection of connections){
        if (!originModules.has(connection.originModule) && connection.originModule !== originModule) {
            originModules.add(connection.originModule);
        }
    }
    return originModules;
}
class TelemetryPlugin {
    // Build feature usage is on/off and is known before the build starts
    constructor(buildFeaturesMap){
        this.usageTracker = new Map();
        for (const featureName of BUILD_FEATURES){
            this.usageTracker.set(featureName, {
                featureName,
                invocationCount: buildFeaturesMap.get(featureName) ? 1 : 0
            });
        }
        for (const featureName of FEATURE_MODULE_MAP.keys()){
            this.usageTracker.set(featureName, {
                featureName,
                invocationCount: 0
            });
        }
        for (const featureName of FEATURE_MODULE_REGEXP_MAP.keys()){
            this.usageTracker.set(featureName, {
                featureName,
                invocationCount: 0
            });
        }
    }
    addUsage(featureName, invocationCount) {
        this.usageTracker.set(featureName, {
            featureName,
            invocationCount
        });
    }
    apply(compiler) {
        compiler.hooks.make.tapAsync(TelemetryPlugin.name, async (compilation, callback)=>{
            compilation.hooks.finishModules.tapAsync(TelemetryPlugin.name, async (modules, modulesFinish)=>{
                for (const module of modules){
                    const feature = findFeatureInModule(module);
                    if (!feature) {
                        continue;
                    }
                    const connections = compilation.moduleGraph.getIncomingConnections(module);
                    const originModules = findUniqueOriginModulesInConnections(connections, module);
                    this.usageTracker.get(feature).invocationCount = originModules.size;
                }
                modulesFinish();
            });
            callback();
        });
        if (compiler.options.mode === 'production' && !compiler.watchMode) {
            compiler.hooks.thisCompilation.tap(TelemetryPlugin.name, (compilation)=>{
                const moduleHooks = compiler.webpack.NormalModule.getCompilationHooks(compilation);
                moduleHooks.loader.tap(TelemetryPlugin.name, (loaderContext)=>{
                    ;
                    loaderContext.eliminatedPackages = eliminatedPackages;
                    loaderContext.useCacheTracker = useCacheTracker;
                });
            });
        }
    }
    usages() {
        return [
            ...this.usageTracker.values()
        ];
    }
    packagesUsedInServerSideProps() {
        return Array.from(eliminatedPackages);
    }
    getUseCacheTracker() {
        return Object.fromEntries(useCacheTracker);
    }
}

//# sourceMappingURL=telemetry-plugin.js.map