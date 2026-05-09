"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    deregisterHook: null,
    registerHook: null,
    requireFromString: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    deregisterHook: function() {
        return deregisterHook;
    },
    registerHook: function() {
        return registerHook;
    },
    requireFromString: function() {
        return requireFromString;
    }
});
const _nodemodule = /*#__PURE__*/ _interop_require_default(require("node:module"));
const _nodefs = require("node:fs");
const _nodepath = require("node:path");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const oldJSHook = require.extensions['.js'];
const extensions = [
    '.ts',
    '.cts',
    '.mts',
    '.cjs',
    '.mjs'
];
function registerHook(swcOptions) {
    // lazy require swc since it loads React before even setting NODE_ENV
    // resulting loading Development React on Production
    const { transformSync } = require('../swc');
    require.extensions['.js'] = function(mod, oldFilename) {
        try {
            return oldJSHook(mod, oldFilename);
        } catch (error) {
            if (error.code !== 'ERR_REQUIRE_ESM') {
                throw error;
            }
            // calling oldJSHook throws ERR_REQUIRE_ESM, so run _compile manually
            // TODO: investigate if we can remove readFileSync
            const content = (0, _nodefs.readFileSync)(oldFilename, 'utf8');
            const { code } = transformSync(content, swcOptions);
            mod._compile(code, oldFilename);
        }
    };
    for (const ext of extensions){
        const oldHook = require.extensions[ext] ?? oldJSHook;
        require.extensions[ext] = function(mod, oldFilename) {
            const _compile = mod._compile;
            mod._compile = function(code, filename) {
                const swc = transformSync(code, swcOptions);
                return _compile.call(this, swc.code, filename);
            };
            return oldHook(mod, oldFilename);
        };
    }
}
function deregisterHook() {
    require.extensions['.js'] = oldJSHook;
    extensions.forEach((ext)=>delete require.extensions[ext]);
}
function requireFromString(code, filename) {
    const paths = _nodemodule.default._nodeModulePaths((0, _nodepath.dirname)(filename));
    const m = new _nodemodule.default(filename, module.parent);
    m.paths = paths;
    m._compile(code, filename);
    return m.exports;
}

//# sourceMappingURL=require-hook.js.map