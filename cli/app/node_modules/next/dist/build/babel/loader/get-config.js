"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return getConfig;
    }
});
const _nodefs = require("node:fs");
const _nodeutil = require("node:util");
const _json5 = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/json5"));
const _core = require("next/dist/compiled/babel/core");
const _corelibconfig = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/babel/core-lib-config"));
const _util = require("./util");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../output/log"));
const _swc = require("../../swc");
const _installbindings = require("../../swc/install-bindings");
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
const nextDistPath = /(next[\\/]dist[\\/]shared[\\/]lib)|(next[\\/]dist[\\/]client)|(next[\\/]dist[\\/]pages)/;
function shouldSkipBabel(transformMode, configFilePath, hasReactCompiler) {
    return transformMode === 'standalone' && configFilePath == null && !hasReactCompiler;
}
const fileExtensionRegex = /\.([a-z]+)$/;
async function getCacheCharacteristics(loaderOptions, source, filename) {
    var _fileExtensionRegex_exec;
    let isStandalone, isServer, pagesDir;
    switch(loaderOptions.transformMode){
        case 'default':
            isStandalone = false;
            isServer = loaderOptions.isServer;
            pagesDir = loaderOptions.pagesDir;
            break;
        case 'standalone':
            isStandalone = true;
            break;
        default:
            throw Object.defineProperty(new Error(`unsupported transformMode in loader options: ${(0, _nodeutil.inspect)(loaderOptions)}`), "__NEXT_ERROR_CODE", {
                value: "E811",
                enumerable: false,
                configurable: true
            });
    }
    const isPageFile = pagesDir != null && filename.startsWith(pagesDir);
    const isNextDist = nextDistPath.test(filename);
    const hasModuleExports = source.indexOf('module.exports') !== -1;
    const fileExt = ((_fileExtensionRegex_exec = fileExtensionRegex.exec(filename)) == null ? void 0 : _fileExtensionRegex_exec[1]) || 'unknown';
    let { reactCompilerPlugins, reactCompilerExclude, configFile: configFilePath, transformMode } = loaderOptions;
    // Compute `hasReactCompiler` as part of the cache characteristics / key,
    // rather than inside of `getFreshConfig`:
    // - `isReactCompilerRequired` depends on the file contents
    // - `node_modules` and `reactCompilerExclude` depend on the file path, which
    //   isn't part of the cache characteristics
    let hasReactCompiler = reactCompilerPlugins != null && reactCompilerPlugins.length !== 0 && !loaderOptions.isServer && !/[/\\]node_modules[/\\]/.test(filename) && // Assumption: `reactCompilerExclude` is cheap because it should only
    // operate on the file path and *not* the file contents (it's sync)
    !(reactCompilerExclude == null ? void 0 : reactCompilerExclude(filename));
    // `isReactCompilerRequired` is expensive to run (parses/visits with SWC), so
    // only run it if there's a good chance we might be able to skip calling Babel
    // entirely (speculatively call `shouldSkipBabel`).
    //
    // Otherwise, we can let react compiler handle this logic for us. It should
    // behave equivalently.
    if (hasReactCompiler && shouldSkipBabel(transformMode, configFilePath, /*hasReactCompiler*/ false)) {
        hasReactCompiler &&= await (0, _swc.isReactCompilerRequired)(filename);
    }
    return {
        isStandalone,
        isServer,
        isPageFile,
        isNextDist,
        hasModuleExports,
        hasReactCompiler,
        fileExt,
        configFilePath
    };
}
/**
 * Return an array of Babel plugins, conditioned upon loader options and
 * source file characteristics.
 */ function getPlugins(loaderOptions, cacheCharacteristics) {
    const { isServer, isPageFile, isNextDist, hasModuleExports } = cacheCharacteristics;
    const { development, hasReactRefresh } = loaderOptions;
    const applyCommonJsItem = hasModuleExports ? (0, _core.createConfigItem)(require('../plugins/commonjs'), {
        type: 'plugin'
    }) : null;
    const reactRefreshItem = hasReactRefresh ? (0, _core.createConfigItem)([
        require('next/dist/compiled/react-refresh/babel'),
        {
            skipEnvCheck: true
        }
    ], {
        type: 'plugin'
    }) : null;
    const pageConfigItem = !isServer && isPageFile ? (0, _core.createConfigItem)([
        require('../plugins/next-page-config')
    ], {
        type: 'plugin'
    }) : null;
    const disallowExportAllItem = !isServer && isPageFile ? (0, _core.createConfigItem)([
        require('../plugins/next-page-disallow-re-export-all-exports')
    ], {
        type: 'plugin'
    }) : null;
    const transformDefineItem = (0, _core.createConfigItem)([
        require.resolve('next/dist/compiled/babel/plugin-transform-define'),
        {
            'process.env.NODE_ENV': development ? 'development' : 'production',
            'typeof window': isServer ? 'undefined' : 'object',
            'process.browser': isServer ? false : true
        },
        'next-js-transform-define-instance'
    ], {
        type: 'plugin'
    });
    const nextSsgItem = !isServer && isPageFile ? (0, _core.createConfigItem)([
        require.resolve('../plugins/next-ssg-transform')
    ], {
        type: 'plugin'
    }) : null;
    const commonJsItem = isNextDist ? (0, _core.createConfigItem)(require('next/dist/compiled/babel/plugin-transform-modules-commonjs'), {
        type: 'plugin'
    }) : null;
    const nextFontUnsupported = (0, _core.createConfigItem)([
        require('../plugins/next-font-unsupported')
    ], {
        type: 'plugin'
    });
    return [
        reactRefreshItem,
        pageConfigItem,
        disallowExportAllItem,
        applyCommonJsItem,
        transformDefineItem,
        nextSsgItem,
        commonJsItem,
        nextFontUnsupported
    ].filter(Boolean);
}
const isJsonFile = /\.(json|babelrc)$/;
const isJsFile = /\.js$/;
/**
 * While this function does block execution while reading from disk, it
 * should not introduce any issues.  The function is only invoked when
 * generating a fresh config, and only a small handful of configs should
 * be generated during compilation.
 */ function getCustomBabelConfig(configFilePath) {
    if (isJsonFile.exec(configFilePath)) {
        const babelConfigRaw = (0, _nodefs.readFileSync)(configFilePath, 'utf8');
        return _json5.default.parse(babelConfigRaw);
    } else if (isJsFile.exec(configFilePath)) {
        return require(configFilePath);
    }
    throw Object.defineProperty(new Error('The Next.js Babel loader does not support .mjs or .cjs config files.'), "__NEXT_ERROR_CODE", {
        value: "E477",
        enumerable: false,
        configurable: true
    });
}
let babelConfigWarned = false;
/**
 * Check if custom babel configuration from user only contains options that
 * can be migrated into latest Next.js features supported by SWC.
 *
 * This raises soft warning messages only, not making any errors yet.
 */ function checkCustomBabelConfigDeprecation(config) {
    if (!config || Object.keys(config).length === 0) {
        return;
    }
    const { plugins, presets, ...otherOptions } = config;
    if (Object.keys(otherOptions ?? {}).length > 0) {
        return;
    }
    if (babelConfigWarned) {
        return;
    }
    babelConfigWarned = true;
    const isPresetReadyToDeprecate = !presets || presets.length === 0 || presets.length === 1 && presets[0] === 'next/babel';
    const pluginReasons = [];
    const unsupportedPlugins = [];
    if (Array.isArray(plugins)) {
        for (const plugin of plugins){
            const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
            // [NOTE]: We cannot detect if the user uses babel-plugin-macro based transform plugins,
            // such as `styled-components/macro` in here.
            switch(pluginName){
                case 'styled-components':
                case 'babel-plugin-styled-components':
                    pluginReasons.push(`\t- 'styled-components' can be enabled via 'compiler.styledComponents' in 'next.config.js'`);
                    break;
                case '@emotion/babel-plugin':
                    pluginReasons.push(`\t- '@emotion/babel-plugin' can be enabled via 'compiler.emotion' in 'next.config.js'`);
                    break;
                case 'babel-plugin-relay':
                    pluginReasons.push(`\t- 'babel-plugin-relay' can be enabled via 'compiler.relay' in 'next.config.js'`);
                    break;
                case 'react-remove-properties':
                    pluginReasons.push(`\t- 'react-remove-properties' can be enabled via 'compiler.reactRemoveProperties' in 'next.config.js'`);
                    break;
                case 'transform-remove-console':
                    pluginReasons.push(`\t- 'transform-remove-console' can be enabled via 'compiler.removeConsole' in 'next.config.js'`);
                    break;
                default:
                    unsupportedPlugins.push(pluginName);
                    break;
            }
        }
    }
    if (isPresetReadyToDeprecate && unsupportedPlugins.length === 0) {
        _log.warn(`It looks like there is a custom Babel configuration that can be removed${pluginReasons.length > 0 ? ':' : '.'}`);
        if (pluginReasons.length > 0) {
            _log.warn(`Next.js supports the following features natively: `);
            _log.warn(pluginReasons.join(''));
            _log.warn(`For more details configuration options, please refer https://nextjs.org/docs/architecture/nextjs-compiler#supported-features`);
        }
    }
}
/**
 * Generate a new, flat Babel config, ready to be handed to Babel-traverse.
 * This config should have no unresolved overrides, presets, etc.
 *
 * The config returned by this function is cached, so the function should not
 * depend on file-specific configuration or configuration that could change
 * across invocations without a process restart.
 */ async function getFreshConfig(ctx, cacheCharacteristics, loaderOptions, target) {
    const { transformMode } = loaderOptions;
    const { hasReactCompiler, configFilePath, fileExt } = cacheCharacteristics;
    let customConfig = configFilePath && getCustomBabelConfig(configFilePath);
    if (shouldSkipBabel(transformMode, configFilePath, hasReactCompiler)) {
        // Optimization: There's nothing useful to do, bail out and skip babel on
        // this file
        return null;
    }
    checkCustomBabelConfigDeprecation(customConfig);
    // We can assume that `reactCompilerPlugins` does not change without a process
    // restart (it's safe to cache), as it's specified in the `next.config.js`,
    // which always causes a full restart of `next dev` if changed.
    const reactCompilerPluginsIfEnabled = hasReactCompiler ? loaderOptions.reactCompilerPlugins ?? [] : [];
    let isServer, pagesDir, srcDir, development;
    if (transformMode === 'default') {
        isServer = loaderOptions.isServer;
        pagesDir = loaderOptions.pagesDir;
        srcDir = loaderOptions.srcDir;
        development = loaderOptions.development;
    }
    let options = {
        babelrc: false,
        cloneInputAst: false,
        // Use placeholder file info. `updateBabelConfigWithFileDetails` will
        // replace this after caching.
        filename: `basename.${fileExt}`,
        inputSourceMap: undefined,
        sourceFileName: `basename.${fileExt}`,
        // Set the default sourcemap behavior based on Webpack's mapping flag,
        // but allow users to override if they want.
        sourceMaps: loaderOptions.sourceMaps === undefined ? ctx.sourceMap : loaderOptions.sourceMaps
    };
    const baseCaller = {
        name: 'next-babel-turbo-loader',
        supportsStaticESM: true,
        supportsDynamicImport: true,
        // Provide plugins with insight into webpack target.
        // https://github.com/babel/babel-loader/issues/787
        target,
        // Webpack 5 supports TLA behind a flag. We enable it by default
        // for Babel, and then webpack will throw an error if the experimental
        // flag isn't enabled.
        supportsTopLevelAwait: true,
        isServer,
        srcDir,
        pagesDir,
        isDev: development,
        transformMode,
        ...loaderOptions.caller
    };
    options.plugins = [
        ...transformMode === 'default' ? getPlugins(loaderOptions, cacheCharacteristics) : [],
        ...reactCompilerPluginsIfEnabled,
        ...(customConfig == null ? void 0 : customConfig.plugins) || []
    ];
    // target can be provided in babelrc
    options.target = isServer ? undefined : customConfig == null ? void 0 : customConfig.target;
    // env can be provided in babelrc
    options.env = customConfig == null ? void 0 : customConfig.env;
    options.presets = (()=>{
        // If presets is defined the user will have next/babel in their babelrc
        if (customConfig == null ? void 0 : customConfig.presets) {
            return customConfig.presets;
        }
        // If presets is not defined the user will likely have "env" in their babelrc
        if (customConfig) {
            return undefined;
        }
        // If no custom config is provided the default is to use next/babel
        return [
            'next/babel'
        ];
    })();
    options.overrides = loaderOptions.overrides;
    options.caller = {
        ...baseCaller,
        hasJsxRuntime: transformMode === 'default' ? loaderOptions.hasJsxRuntime : undefined
    };
    // Babel does strict checks on the config so undefined is not allowed
    if (typeof options.target === 'undefined') {
        delete options.target;
    }
    Object.defineProperty(options.caller, 'onWarning', {
        enumerable: false,
        writable: false,
        value: (reason)=>{
            if (!(reason instanceof Error)) {
                reason = Object.defineProperty(new Error(reason), "__NEXT_ERROR_CODE", {
                    value: "E394",
                    enumerable: false,
                    configurable: true
                });
            }
            ctx.emitWarning(reason);
        }
    });
    const loadedOptions = (0, _core.loadOptions)(options);
    const config = (0, _util.consumeIterator)((0, _corelibconfig.default)(loadedOptions));
    return config;
}
/**
 * Each key returned here corresponds with a Babel config that can be shared.
 * The conditions of permissible sharing between files is dependent on specific
 * file attributes and Next.js compiler states: `CharacteristicsGermaneToCaching`.
 */ function getCacheKey(cacheCharacteristics) {
    const { isStandalone, isServer, isPageFile, isNextDist, hasModuleExports, hasReactCompiler, fileExt, configFilePath } = cacheCharacteristics;
    const flags = 0 | (isStandalone ? 1 : 0) | (isServer ? 2 : 0) | (isPageFile ? 4 : 0) | (isNextDist ? 8 : 0) | (hasModuleExports ? 16 : 0) | (hasReactCompiler ? 32 : 0);
    // separate strings with null bytes, assuming null bytes are not valid in file
    // paths
    return `${configFilePath || ''}\x00${fileExt}\x00${flags}`;
}
const configCache = new Map();
const configFiles = new Set();
/**
 * Applies file-specific values to a potentially-cached configuration object.
 */ function updateBabelConfigWithFileDetails(cachedConfig, loaderOptions, filename, inputSourceMap) {
    if (cachedConfig == null) {
        return null;
    }
    return {
        ...cachedConfig,
        options: {
            ...cachedConfig.options,
            cwd: loaderOptions.cwd,
            root: loaderOptions.cwd,
            filename,
            inputSourceMap,
            // Ensure that Webpack will get a full absolute path in the sourcemap
            // so that it can properly map the module back to its internal cached
            // modules.
            sourceFileName: filename
        }
    };
}
async function getConfig(ctx, { source, target, loaderOptions, filename, inputSourceMap }) {
    // Install bindings early so they are definitely available to the loader.
    // When run by webpack in next this is already done with correct configuration so this is a no-op.
    // In turbopack loaders are run in a subprocess so it may or may not be done.
    await (0, _installbindings.installBindings)();
    const cacheCharacteristics = await getCacheCharacteristics(loaderOptions, source, filename);
    if (loaderOptions.configFile) {
        // Ensures webpack invalidates the cache for this loader when the config file changes
        ctx.addDependency(loaderOptions.configFile);
    }
    const cacheKey = getCacheKey(cacheCharacteristics);
    const cachedConfig = configCache.get(cacheKey);
    if (cachedConfig !== undefined) {
        return updateBabelConfigWithFileDetails(cachedConfig, loaderOptions, filename, inputSourceMap);
    }
    if (loaderOptions.configFile && !configFiles.has(loaderOptions.configFile)) {
        configFiles.add(loaderOptions.configFile);
        _log.info(`Using external babel configuration from ${loaderOptions.configFile}`);
    }
    const freshConfig = await getFreshConfig(ctx, cacheCharacteristics, loaderOptions, target);
    configCache.set(cacheKey, freshConfig);
    return updateBabelConfigWithFileDetails(freshConfig, loaderOptions, filename, inputSourceMap);
}

//# sourceMappingURL=get-config.js.map