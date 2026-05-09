"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSignatureFunctionForTransform = exports.register = void 0;
exports.refresh = refresh;
const helpers_1 = __importDefault(require("./helpers"));
// Extracts exports from a webpack module object.
function getModuleExports(moduleId) {
    if (typeof moduleId === 'undefined') {
        // `moduleId` is unavailable, which indicates that this module is not in the cache,
        // which means we won't be able to capture any exports,
        // and thus they cannot be refreshed safely.
        // These are likely runtime or dynamically generated modules.
        return {};
    }
    var maybeModule = __webpack_require__.c[moduleId];
    if (typeof maybeModule === 'undefined') {
        // `moduleId` is available but the module in cache is unavailable,
        // which indicates the module is somehow corrupted (e.g. broken Webpack `module` globals).
        // We will warn the user (as this is likely a mistake) and assume they cannot be refreshed.
        console.warn('[React Refresh] Failed to get exports for module: ' + moduleId + '.');
        return {};
    }
    var exportsOrPromise = maybeModule.exports;
    if (typeof Promise !== 'undefined' && exportsOrPromise instanceof Promise) {
        return exportsOrPromise.then(function (exports) {
            return exports;
        });
    }
    return exportsOrPromise;
}
function executeRuntime(moduleExports, moduleId, webpackHot) {
    var _a, _b;
    helpers_1.default.registerExportsForReactRefresh(moduleExports, moduleId);
    if (webpackHot) {
        var isHotUpdate = !!webpackHot.data;
        var prevSignature = (_b = (_a = webpackHot.data) === null || _a === void 0 ? void 0 : _a.prevSignature) !== null && _b !== void 0 ? _b : null;
        if (helpers_1.default.isReactRefreshBoundary(moduleExports)) {
            webpackHot.dispose(
            // Save the previous exports signature on update so we can compare the boundary
            // signatures. We avoid saving exports themselves since it causes memory leaks (https://github.com/vercel/next.js/pull/53797)
            function hotDisposeCallback(data) {
                data.prevSignature =
                    helpers_1.default.getRefreshBoundarySignature(moduleExports);
            });
            webpackHot.accept();
            // This field is set when the previous version of this module was a
            // Refresh Boundary, letting us know we need to check for invalidation or
            // enqueue an update.
            if (prevSignature !== null) {
                if (isHotUpdate) {
                    if (helpers_1.default.shouldInvalidateReactRefreshBoundary(prevSignature, helpers_1.default.getRefreshBoundarySignature(moduleExports))) {
                        webpackHot.invalidate();
                    }
                    else {
                        helpers_1.default.scheduleUpdate();
                    }
                }
            }
        }
        else {
            if (isHotUpdate && prevSignature !== null) {
                webpackHot.invalidate();
            }
        }
    }
}
// Port from https://github.com/pmmmwh/react-refresh-webpack-plugin/blob/main/loader/utils/getRefreshModuleRuntime.js#L29
function refresh(moduleId, webpackHot) {
    const currentExports = getModuleExports(moduleId);
    const fn = (exports) => {
        executeRuntime(exports, moduleId, webpackHot);
    };
    if (typeof Promise !== 'undefined' && currentExports instanceof Promise) {
        currentExports.then(fn);
    }
    else {
        fn(currentExports);
    }
}
var runtime_1 = require("next/dist/compiled/react-refresh/runtime");
Object.defineProperty(exports, "register", { enumerable: true, get: function () { return runtime_1.register; } });
Object.defineProperty(exports, "createSignatureFunctionForTransform", { enumerable: true, get: function () { return runtime_1.createSignatureFunctionForTransform; } });
//# sourceMappingURL=RspackReactRefresh.js.map