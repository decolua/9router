"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "transpileConfig", {
    enumerable: true,
    get: function() {
        return transpileConfig;
    }
});
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
const _nodefs = require("node:fs");
const _nodeurl = require("node:url");
const _commentjson = /*#__PURE__*/ _interop_require_wildcard(require("next/dist/compiled/comment-json"));
const _requirehook = require("./require-hook");
const _log = require("../output/log");
const _utils = require("../../server/lib/utils");
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
function resolveSWCOptions(cwd, compilerOptions) {
    var _process_versions, _process;
    return {
        jsc: {
            parser: {
                syntax: 'typescript'
            },
            ...compilerOptions.paths ? {
                paths: compilerOptions.paths
            } : {},
            ...compilerOptions.baseUrl ? {
                baseUrl: _nodepath.default.resolve(cwd, compilerOptions.baseUrl)
            } : compilerOptions.paths ? {
                baseUrl: cwd
            } : {}
        },
        module: {
            type: 'commonjs'
        },
        isModule: 'unknown',
        env: {
            targets: {
                // Setting the Node.js version can reduce unnecessary code generation.
                node: ((_process = process) == null ? void 0 : (_process_versions = _process.versions) == null ? void 0 : _process_versions.node) ?? '20.19.0'
            }
        }
    };
}
function resolveExtends(extendsPath, currentConfigDir) {
    // Relative paths are resolved relative to the current config's directory
    if (extendsPath.startsWith('./') || extendsPath.startsWith('../') || _nodepath.default.isAbsolute(extendsPath)) {
        const resolved = _nodepath.default.resolve(currentConfigDir, extendsPath);
        // TypeScript allows omitting .json extension
        if ((0, _nodefs.existsSync)(resolved)) {
            return resolved;
        }
        if (!resolved.endsWith('.json') && (0, _nodefs.existsSync)(resolved + '.json')) {
            return resolved + '.json';
        }
        return resolved;
    }
    // Package paths - use require.resolve to find the package
    try {
        // Try resolving as a direct path within the package
        return require.resolve(extendsPath, {
            paths: [
                currentConfigDir
            ]
        });
    } catch  {
        // If that fails, try appending tsconfig.json for package names like "@tsconfig/node18"
        try {
            return require.resolve(extendsPath + '/tsconfig.json', {
                paths: [
                    currentConfigDir
                ]
            });
        } catch  {
            // Return the original path and let it fail later with a clear error
            return _nodepath.default.resolve(currentConfigDir, extendsPath);
        }
    }
}
function loadTsConfigFile(configPath, visited) {
    const resolvedPath = _nodepath.default.resolve(configPath);
    if (visited.has(resolvedPath)) {
        return {};
    }
    visited.add(resolvedPath);
    if (!(0, _nodefs.existsSync)(resolvedPath)) {
        return {};
    }
    const configContent = (0, _nodefs.readFileSync)(resolvedPath, 'utf8');
    const config = _commentjson.parse(configContent);
    const configDir = _nodepath.default.dirname(resolvedPath);
    let mergedOptions = {};
    // Note that config options from `extends` should get overwritten, not merged
    if (config.extends) {
        const extendsList = Array.isArray(config.extends) ? config.extends : [
            config.extends
        ];
        for (const extendsPath of extendsList){
            const parentConfigPath = resolveExtends(extendsPath, configDir);
            const parentOptions = loadTsConfigFile(parentConfigPath, visited);
            mergedOptions = {
                ...mergedOptions,
                ...parentOptions
            };
        }
    }
    const currentOptions = config.compilerOptions ?? {};
    mergedOptions = {
        ...mergedOptions,
        paths: currentOptions.paths ?? mergedOptions.paths,
        baseUrl: currentOptions.baseUrl ?? mergedOptions.baseUrl
    };
    return mergedOptions;
}
async function loadTsConfig(dir) {
    // NOTE: This doesn't fully cover the edge case for setting
    // "typescript.tsconfigPath" in next config which is currently
    // a restriction.
    // It's a chicken-and-egg problem since we need to transpile
    // the next config to get that value.
    const resolvedTsConfigPath = _nodepath.default.join(dir, 'tsconfig.json');
    if (!(0, _nodefs.existsSync)(resolvedTsConfigPath)) {
        return {};
    }
    return loadTsConfigFile(resolvedTsConfigPath, new Set());
}
async function transpileConfig({ nextConfigPath, dir }) {
    try {
        // envs are passed to the workers and preserve the flag
        if (process.env.__NEXT_NODE_NATIVE_TS_LOADER_ENABLED === 'true') {
            try {
                // Node.js v22.10.0+
                // Value is 'strip' or 'transform' based on how the feature is enabled.
                // https://nodejs.org/api/process.html#processfeaturestypescript
                // TODO: Remove `as any` once we bump @types/node to v22.10.0+
                if (process.features.typescript) {
                    // Run import() here to catch errors and fallback to legacy resolution.
                    return (await import((0, _nodeurl.pathToFileURL)(nextConfigPath).href)).default;
                }
                if ((0, _utils.getNodeOptionsArgs)().includes('--no-experimental-strip-types') || process.execArgv.includes('--no-experimental-strip-types')) {
                    (0, _log.warnOnce)(`Skipped resolving "${_nodepath.default.basename(nextConfigPath)}" using Node.js native TypeScript resolution because it was disabled by the "--no-experimental-strip-types" flag.` + ' Falling back to legacy resolution.' + ' Learn more: https://nextjs.org/docs/app/api-reference/config/typescript#using-nodejs-native-typescript-resolver-for-nextconfigts');
                }
                // Feature is not enabled, fallback to legacy resolution for current session.
                process.env.__NEXT_NODE_NATIVE_TS_LOADER_ENABLED = 'false';
            } catch (cause) {
                (0, _log.warnOnce)(`Failed to import "${_nodepath.default.basename(nextConfigPath)}" using Node.js native TypeScript resolution.` + ' Falling back to legacy resolution.' + ' Learn more: https://nextjs.org/docs/app/api-reference/config/typescript#using-nodejs-native-typescript-resolver-for-nextconfigts', {
                    cause
                });
                // Once failed, fallback to legacy resolution for current session.
                process.env.__NEXT_NODE_NATIVE_TS_LOADER_ENABLED = 'false';
            }
        }
        const compilerOptions = await loadTsConfig(dir);
        return handleCJS({
            dir,
            nextConfigPath,
            compilerOptions
        });
    } catch (cause) {
        throw Object.defineProperty(new Error(`Failed to transpile "${_nodepath.default.basename(nextConfigPath)}".`, {
            cause
        }), "__NEXT_ERROR_CODE", {
            value: "E797",
            enumerable: false,
            configurable: true
        });
    }
}
async function handleCJS({ dir, nextConfigPath, compilerOptions }) {
    const swcOptions = resolveSWCOptions(dir, compilerOptions);
    let hasRequire = false;
    try {
        var _config_experimental;
        const nextConfigString = (0, _nodefs.readFileSync)(nextConfigPath, 'utf8');
        // lazy require swc since it loads React before even setting NODE_ENV
        // resulting loading Development React on Production
        const { loadBindings } = require('../swc');
        const bindings = await loadBindings();
        const { code } = await bindings.transform(nextConfigString, swcOptions);
        // register require hook only if require exists
        if (code.includes('require(')) {
            (0, _requirehook.registerHook)(swcOptions);
            hasRequire = true;
        }
        // filename & extension don't matter here
        const config = (0, _requirehook.requireFromString)(code, _nodepath.default.resolve(dir, 'next.config.compiled.js'));
        // At this point we have already loaded the bindings without this configuration setting due to the `transform` call above.
        // Possibly we fell back to wasm in which case, it all works out but if not we need to warn
        // that the configuration was ignored.
        if ((config == null ? void 0 : (_config_experimental = config.experimental) == null ? void 0 : _config_experimental.useWasmBinary) && !bindings.isWasm) {
            (0, _log.warn)('Using a next.config.ts file is incompatible with `experimental.useWasmBinary` unless ' + '`--experimental-next-config-strip-types` is also passed.\nSetting `useWasmBinary` to `false');
            config.experimental.useWasmBinary = false;
        }
        return config;
    } catch (error) {
        throw error;
    } finally{
        if (hasRequire) {
            (0, _requirehook.deregisterHook)();
        }
    }
}

//# sourceMappingURL=transpile-config.js.map