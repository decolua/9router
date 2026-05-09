"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "base", {
    enumerable: true,
    get: function() {
        return base;
    }
});
const _lodashcurry = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/lodash.curry"));
const _constants = require("../../../../shared/lib/constants");
const _devtoolsignorelistplugin = /*#__PURE__*/ _interop_require_default(require("../../plugins/devtools-ignore-list-plugin"));
const _evalsourcemapdevtoolplugin = /*#__PURE__*/ _interop_require_default(require("../../plugins/eval-source-map-dev-tool-plugin"));
const _getrspack = require("../../../../shared/lib/get-rspack");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function shouldIgnorePath(modulePath) {
    return modulePath.includes('node_modules') || modulePath.endsWith('__nextjs-internal-proxy.cjs') || modulePath.endsWith('__nextjs-internal-proxy.mjs') || // Only relevant for when Next.js is symlinked e.g. in the Next.js monorepo
    modulePath.includes('next/dist');
}
const base = (0, _lodashcurry.default)(function base(ctx, config) {
    config.mode = ctx.isDevelopment ? 'development' : 'production';
    config.name = ctx.isServer ? ctx.isEdgeRuntime ? _constants.COMPILER_NAMES.edgeServer : _constants.COMPILER_NAMES.server : _constants.COMPILER_NAMES.client;
    config.target = !ctx.targetWeb ? 'node18.17' // Same version defined in packages/next/package.json#engines
     : ctx.isEdgeRuntime ? [
        'web',
        'es6'
    ] : [
        'web',
        'es6'
    ];
    // https://webpack.js.org/configuration/devtool/#development
    if (ctx.isDevelopment) {
        // `eval-source-map` provides full-fidelity source maps for the
        // original source, including columns and original variable names.
        // This is desirable so the in-browser debugger can correctly pause
        // and show scoped variables with their original names.
        config.devtool = 'eval-source-map';
    } else {
        if (ctx.isEdgeRuntime || ctx.isServer && ctx.serverSourceMaps || // Enable browser sourcemaps:
        ctx.productionBrowserSourceMaps && ctx.isClient) {
            config.devtool = 'source-map';
        } else {
            config.devtool = false;
        }
    }
    if (!config.module) {
        config.module = {
            rules: []
        };
    }
    config.plugins ??= [];
    if (config.devtool === 'source-map' && !process.env.NEXT_RSPACK) {
        config.plugins.push(new _devtoolsignorelistplugin.default({
            shouldIgnorePath
        }));
    } else if (config.devtool === 'eval-source-map') {
        // We're using a fork of `eval-source-map`
        config.devtool = false;
        if (process.env.NEXT_RSPACK) {
            var _config_output;
            config.plugins.push(new ((0, _getrspack.getRspackCore)()).EvalSourceMapDevToolPlugin({
                moduleFilenameTemplate: (_config_output = config.output) == null ? void 0 : _config_output.devtoolModuleFilenameTemplate
            }));
        } else {
            var _config_output1;
            config.plugins.push(new _evalsourcemapdevtoolplugin.default({
                moduleFilenameTemplate: (_config_output1 = config.output) == null ? void 0 : _config_output1.devtoolModuleFilenameTemplate,
                shouldIgnorePath
            }));
        }
    }
    // TODO: add codemod for "Should not import the named export" with JSON files
    // config.module.strictExportPresence = !isWebpack5
    return config;
});

//# sourceMappingURL=base.js.map