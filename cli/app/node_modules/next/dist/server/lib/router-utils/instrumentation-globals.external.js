"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ensureInstrumentationRegistered: null,
    getInstrumentationModule: null,
    instrumentationOnRequestError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ensureInstrumentationRegistered: function() {
        return ensureInstrumentationRegistered;
    },
    getInstrumentationModule: function() {
        return getInstrumentationModule;
    },
    instrumentationOnRequestError: function() {
        return instrumentationOnRequestError;
    }
});
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
const _iserror = /*#__PURE__*/ _interop_require_default(require("../../../lib/is-error"));
const _constants = require("../../../lib/constants");
const _interopdefault = require("../../../lib/interop-default");
const _instrumentationnodeextensions = require("./instrumentation-node-extensions");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
let cachedInstrumentationModule;
async function getInstrumentationModule(projectDir, distDir) {
    if (cachedInstrumentationModule) {
        return cachedInstrumentationModule;
    }
    try {
        cachedInstrumentationModule = (0, _interopdefault.interopDefault)(await require(_nodepath.default.join(projectDir, distDir, 'server', `${_constants.INSTRUMENTATION_HOOK_FILENAME}.js`)));
        return cachedInstrumentationModule;
    } catch (err) {
        if ((0, _iserror.default)(err) && err.code !== 'ENOENT' && err.code !== 'MODULE_NOT_FOUND' && err.code !== 'ERR_MODULE_NOT_FOUND') {
            throw err;
        }
    }
}
let instrumentationModulePromise = null;
async function registerInstrumentation(projectDir, distDir) {
    // Ensure registerInstrumentation is not called in production build
    if (process.env.NEXT_PHASE === 'phase-production-build') {
        return;
    }
    if (!instrumentationModulePromise) {
        instrumentationModulePromise = getInstrumentationModule(projectDir, distDir);
    }
    const instrumentation = await instrumentationModulePromise;
    if (instrumentation == null ? void 0 : instrumentation.register) {
        try {
            await instrumentation.register();
            (0, _instrumentationnodeextensions.afterRegistration)();
        } catch (err) {
            err.message = `An error occurred while loading instrumentation hook: ${err.message}`;
            throw err;
        }
    }
}
async function instrumentationOnRequestError(projectDir, distDir, ...args) {
    const instrumentation = await getInstrumentationModule(projectDir, distDir);
    try {
        var _instrumentation_onRequestError;
        await (instrumentation == null ? void 0 : (_instrumentation_onRequestError = instrumentation.onRequestError) == null ? void 0 : _instrumentation_onRequestError.call(instrumentation, ...args));
    } catch (err) {
        // Log the soft error and continue, since the original error has already been thrown
        console.error('Error in instrumentation.onRequestError:', err);
    }
}
let registerInstrumentationPromise = null;
function ensureInstrumentationRegistered(projectDir, distDir) {
    if (!registerInstrumentationPromise) {
        registerInstrumentationPromise = registerInstrumentation(projectDir, distDir);
    }
    return registerInstrumentationPromise;
}

//# sourceMappingURL=instrumentation-globals.external.js.map