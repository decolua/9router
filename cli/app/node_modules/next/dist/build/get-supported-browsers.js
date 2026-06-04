"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getSupportedBrowsers", {
    enumerable: true,
    get: function() {
        return getSupportedBrowsers;
    }
});
const _browserslist = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/browserslist"));
const _constants = require("../shared/lib/constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function getSupportedBrowsers(dir, isDevelopment) {
    let browsers;
    try {
        const browsersListConfig = _browserslist.default.loadConfig({
            path: dir,
            env: isDevelopment ? 'development' : 'production'
        });
        // Running `browserslist` resolves `extends` and other config features into a list of browsers
        if (browsersListConfig && browsersListConfig.length > 0) {
            browsers = (0, _browserslist.default)(browsersListConfig);
        }
    } catch  {}
    // When user has browserslist use that target
    if (browsers && browsers.length > 0) {
        return browsers;
    }
    // Uses modern browsers as the default.
    return _constants.MODERN_BROWSERSLIST_TARGET;
}

//# sourceMappingURL=get-supported-browsers.js.map