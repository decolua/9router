"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, /**
 * Depending on if Rspack is active or not, returns the appropriate set of
 * webpack-compatible api.
 *
 * @returns webpack bundler
 */ "default", {
    enumerable: true,
    get: function() {
        return getWebpackBundler;
    }
});
const _webpack = require("next/dist/compiled/webpack/webpack");
const _getrspack = require("./get-rspack");
function getWebpackBundler() {
    return process.env.NEXT_RSPACK ? (0, _getrspack.getRspackCore)() : _webpack.webpack;
}

//# sourceMappingURL=get-webpack-bundler.js.map