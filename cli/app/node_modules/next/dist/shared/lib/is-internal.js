/** React that's compiled with `next`. Used by App Router. */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    default: null,
    nextInternalsRe: null,
    reactNodeModulesRe: null,
    reactVendoredRe: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    default: function() {
        return isInternal;
    },
    nextInternalsRe: function() {
        return nextInternalsRe;
    },
    reactNodeModulesRe: function() {
        return reactNodeModulesRe;
    },
    reactVendoredRe: function() {
        return reactVendoredRe;
    }
});
const reactVendoredRe = /[\\/]next[\\/]dist[\\/]compiled[\\/](react|react-dom|react-server-dom-(webpack|turbopack)|scheduler)[\\/]/;
const reactNodeModulesRe = /node_modules[\\/](react|react-dom|scheduler)[\\/]/;
const nextInternalsRe = /(node_modules[\\/]next[\\/]|[\\/].next[\\/]static[\\/]chunks[\\/]webpack\.js$|(edge-runtime-webpack|webpack-runtime)\.js$)/;
function isInternal(file) {
    if (!file) return false;
    // NOTE: native code has a version of the same logic in crates/next-napi-bindings/src/next_api/utils.rs
    // keep them in sync.
    return nextInternalsRe.test(file) || reactVendoredRe.test(file) || reactNodeModulesRe.test(file);
}

//# sourceMappingURL=is-internal.js.map