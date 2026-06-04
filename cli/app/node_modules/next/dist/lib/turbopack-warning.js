"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "validateTurboNextConfig", {
    enumerable: true,
    get: function() {
        return validateTurboNextConfig;
    }
});
const _config = /*#__PURE__*/ _interop_require_default(require("../server/config"));
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
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
const unsupportedTurbopackNextConfigOptions = [
    // Left to be implemented (priority)
    // 'experimental.clientRouterFilter',
    // 'experimental.optimizePackageImports',
    // 'compiler.emotion',
    // 'compiler.reactRemoveProperties',
    // 'compiler.relay',
    // 'compiler.removeConsole',
    // 'compiler.styledComponents',
    'experimental.fetchCacheKeyPrefix',
    // Left to be implemented
    // 'excludeDefaultMomentLocales',
    // 'experimental.optimizeServerReact',
    'experimental.clientRouterFilterAllowedRate',
    // 'experimental.serverMinification',
    // 'experimental.serverSourceMaps',
    'experimental.allowedRevalidateHeaderKeys',
    'experimental.extensionAlias',
    'experimental.fallbackNodePolyfills',
    'experimental.swcTraceProfiling',
    // Left to be implemented (Might not be needed for Turbopack)
    'experimental.craCompat',
    'experimental.disablePostcssPresetEnv',
    'experimental.esmExternals',
    // This is used to force swc-loader to run regardless of finding Babel.
    'experimental.forceSwcTransforms',
    'experimental.fullySpecified',
    'experimental.urlImports',
    'experimental.slowModuleDetection'
];
async function validateTurboNextConfig({ dir, configPhase }) {
    const { defaultConfig } = require('../server/config-shared');
    const { cyan, red, underline } = require('../lib/picocolors');
    const { interopDefault } = require('../lib/interop-default');
    let unsupportedParts = '';
    let hasWebpackConfig = false;
    let hasTurboConfig = false;
    const unsupportedConfig = [];
    let rawNextConfig = {};
    try {
        rawNextConfig = interopDefault(await (0, _config.default)(configPhase, dir, {
            rawConfig: true
        }));
        if (typeof rawNextConfig === 'function') {
            rawNextConfig = rawNextConfig(configPhase, {
                defaultConfig
            });
        }
        hasWebpackConfig = Boolean(rawNextConfig.webpack);
        hasTurboConfig = Boolean(rawNextConfig.turbopack);
        const flattenKeys = (obj, prefix = '')=>{
            let keys = [];
            for(const key in obj){
                const value = obj == null ? void 0 : obj[key];
                if (typeof value === 'undefined') {
                    continue;
                }
                const pre = prefix.length ? `${prefix}.` : '';
                if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
                    keys = keys.concat(flattenKeys(value, pre + key));
                } else {
                    keys.push(pre + key);
                }
            }
            return keys;
        };
        const getDeepValue = (obj, keys)=>{
            if (typeof keys === 'string') {
                keys = keys.split('.');
            }
            if (keys.length === 1) {
                return obj == null ? void 0 : obj[keys == null ? void 0 : keys[0]];
            }
            return getDeepValue(obj == null ? void 0 : obj[keys == null ? void 0 : keys[0]], keys.slice(1));
        };
        const customKeys = flattenKeys(rawNextConfig);
        for (const key of customKeys){
            if (key.startsWith('experimental.turbo')) {
                hasTurboConfig = true;
            }
            const isUnsupported = unsupportedTurbopackNextConfigOptions.some((unsupportedKey)=>// Either the key matches (or is a more specific subkey) of
                // unsupportedKey, or the key is the path to a specific subkey.
                // | key     | unsupportedKey |
                // |---------|----------------|
                // | foo     | foo            |
                // | foo.bar | foo            |
                // | foo     | foo.bar        |
                key.startsWith(unsupportedKey) || unsupportedKey.startsWith(`${key}.`)) && getDeepValue(rawNextConfig, key) !== getDeepValue(defaultConfig, key);
            if (isUnsupported) {
                unsupportedConfig.push(key);
            }
        }
    } catch (e) {
        _log.error('Unexpected error occurred while checking config', e);
    }
    // If the build was defaulted to Turbopack, we want to warn about possibly ignored webpack
    // configuration. Otherwise the user explicitly picked turbopack and thus we expect that
    // they have configured it correctly.
    if (process.env.TURBOPACK === 'auto' && hasWebpackConfig && !hasTurboConfig) {
        const configFile = rawNextConfig.configFileName ?? 'your Next config file';
        _log.error(`ERROR: This build is using Turbopack, with a \`webpack\` config and no \`turbopack\` config.
   This may be a mistake.

   As of Next.js 16 Turbopack is enabled by default and
   custom webpack configurations may need to be migrated to Turbopack.

   NOTE: your \`webpack\` config may have been added by a configuration plugin.

   To configure Turbopack, see https://nextjs.org/docs/app/api-reference/next-config-js/turbopack

   TIP: Many applications work fine under Turbopack with no configuration,
   if that is the case for you, you can silence this error by passing the
   \`--turbopack\` or \`--webpack\` flag explicitly or simply setting an 
   empty turbopack config in ${configFile} (e.g. \`turbopack: {}\`).`);
        process.exit(1);
    }
    if (unsupportedConfig.length) {
        unsupportedParts += `\n\n- Unsupported Next.js configuration option(s) (${cyan('next.config.js')})\n  Turbopack will ignore the following configuration options:\n${unsupportedConfig.map((name)=>`    - ${red(name)}\n`).join('')}`;
    }
    if (unsupportedParts) {
        _log.error(`You are using configuration and/or tools that are not yet\nsupported by Next.js with Turbopack:\n${unsupportedParts}\n`);
        _log.warn('Learn more about how to configure Turbopack with Next.js:\n' + underline('https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack'));
    }
    return rawNextConfig;
}

//# sourceMappingURL=turbopack-warning.js.map