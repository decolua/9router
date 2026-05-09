"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PLUGIN_NAME = 'ReactRefreshRspackPlugin';
class ReactRefreshRspackPlugin {
    apply(compiler) {
        new compiler.webpack.ProvidePlugin({
            $ReactRefreshRuntime$: require.resolve('./internal/RspackReactRefresh'),
        }).apply(compiler);
        compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
            compilation.hooks.additionalTreeRuntimeRequirements.tap(PLUGIN_NAME, (_, runtimeRequirements) => {
                runtimeRequirements.add(compiler.webpack.RuntimeGlobals.moduleCache);
            });
        });
    }
}
ReactRefreshRspackPlugin.loader = 'builtin:react-refresh-loader';
exports.default = ReactRefreshRspackPlugin;
//# sourceMappingURL=ReactRefreshRspackPlugin.js.map