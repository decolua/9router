"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getEnvInfo: null,
    logExperimentalInfo: null,
    logStartInfo: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getEnvInfo: function() {
        return getEnvInfo;
    },
    logExperimentalInfo: function() {
        return logExperimentalInfo;
    },
    logStartInfo: function() {
        return logStartInfo;
    }
});
const _env = require("@next/env");
const _inspector = /*#__PURE__*/ _interop_require_wildcard(require("inspector"));
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../build/output/log"));
const _picocolors = require("../../lib/picocolors");
const _configschema = require("../config-schema");
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
function logStartInfo({ networkUrl, appUrl, envInfo, logBundler }) {
    let versionSuffix = '';
    const parts = [];
    if (logBundler) {
        if (process.env.TURBOPACK) {
            parts.push('Turbopack');
        } else if (process.env.NEXT_RSPACK) {
            parts.push('Rspack');
        } else {
            parts.push('webpack');
        }
    }
    if (parts.length > 0) {
        versionSuffix = ` (${parts.join(', ')})`;
    }
    _log.bootstrap(`${(0, _picocolors.bold)((0, _picocolors.purple)(`${_log.prefixes.ready} Next.js ${"16.2.1"}`))}${versionSuffix}`);
    if (appUrl) {
        _log.bootstrap(`- Local:         ${appUrl}`);
    }
    if (networkUrl) {
        _log.bootstrap(`- Network:       ${networkUrl}`);
    }
    const inspectorUrl = _inspector.url();
    if (inspectorUrl) {
        // Could also parse this port from the inspector URL.
        // process.debugPort will always be defined even if the process is not being inspected.
        // The full URL seems noisy as far as I can tell.
        // Node.js will print the full URL anyway.
        const debugPort = process.debugPort;
        _log.bootstrap(`- Debugger port: ${debugPort}`);
    }
    if (envInfo == null ? void 0 : envInfo.length) _log.bootstrap(`- Environments: ${envInfo.join(', ')}`);
}
function logExperimentalInfo({ experimentalFeatures, cacheComponents }) {
    if (cacheComponents) {
        _log.bootstrap(`- Cache Components enabled`);
    }
    if (experimentalFeatures == null ? void 0 : experimentalFeatures.length) {
        _log.bootstrap(`- Experiments (use with caution):`);
        for (const exp of experimentalFeatures){
            const isValid = Object.prototype.hasOwnProperty.call(_configschema.experimentalSchema, exp.key);
            if (isValid) {
                const symbol = typeof exp.value === 'boolean' ? exp.value === true ? (0, _picocolors.bold)('✓') : (0, _picocolors.bold)('⨯') : '·';
                const suffix = typeof exp.value === 'number' || typeof exp.value === 'string' ? `: ${JSON.stringify(exp.value)}` : '';
                const reason = exp.reason ? ` (${exp.reason})` : '';
                _log.bootstrap(`  ${symbol} ${exp.key}${suffix}${reason}`);
            } else {
                _log.bootstrap(`  ? ${(0, _picocolors.strikethrough)(exp.key)} (invalid experimental key)`);
            }
        }
    }
    // New line after the bootstrap info
    _log.info('');
}
function getEnvInfo(dir) {
    const { loadedEnvFiles } = (0, _env.loadEnvConfig)(dir, true, console, false);
    return loadedEnvFiles.map((f)=>f.path);
}

//# sourceMappingURL=app-info-log.js.map