// A basic implementation to allow loaders access to loaderContext.currentTraceSpan
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    RspackProfilingPlugin: null,
    compilationSpans: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    RspackProfilingPlugin: function() {
        return RspackProfilingPlugin;
    },
    compilationSpans: function() {
        return compilationSpans;
    }
});
const _getrspack = require("../../../shared/lib/get-rspack");
const pluginName = 'RspackProfilingPlugin';
const moduleSpansByCompilation = new WeakMap();
const compilationSpans = new WeakMap();
class RspackProfilingPlugin {
    constructor({ runWebpackSpan }){
        this.runWebpackSpan = runWebpackSpan;
    }
    apply(compiler) {
        compiler.hooks.thisCompilation.tap({
            name: pluginName,
            stage: -Infinity
        }, (compilation)=>{
            const rspack = (0, _getrspack.getRspackCore)();
            moduleSpansByCompilation.set(compilation, new WeakMap());
            compilationSpans.set(compilation, this.runWebpackSpan.traceChild('compilation-' + compilation.name));
            const compilationSpan = this.runWebpackSpan.traceChild(`compilation-${compilation.name}`);
            const moduleHooks = rspack.NormalModule.getCompilationHooks(compilation);
            moduleHooks.loader.tap(pluginName, (loaderContext, module1)=>{
                var _moduleSpansByCompilation_get;
                const moduleSpan = (_moduleSpansByCompilation_get = moduleSpansByCompilation.get(compilation)) == null ? void 0 : _moduleSpansByCompilation_get.get(module1);
                loaderContext.currentTraceSpan = moduleSpan;
            });
            compilation.hooks.buildModule.tap(pluginName, (module1)=>{
                var _moduleSpansByCompilation_get;
                const span = compilationSpan.traceChild('build-module');
                span.setAttribute('name', module1.userRequest);
                span.setAttribute('layer', module1.layer);
                moduleSpansByCompilation == null ? void 0 : (_moduleSpansByCompilation_get = moduleSpansByCompilation.get(compilation)) == null ? void 0 : _moduleSpansByCompilation_get.set(module1, span);
            });
            compilation.hooks.succeedModule.tap(pluginName, (module1)=>{
                var _moduleSpansByCompilation_get_get, _moduleSpansByCompilation_get;
                moduleSpansByCompilation == null ? void 0 : (_moduleSpansByCompilation_get = moduleSpansByCompilation.get(compilation)) == null ? void 0 : (_moduleSpansByCompilation_get_get = _moduleSpansByCompilation_get.get(module1)) == null ? void 0 : _moduleSpansByCompilation_get_get.stop();
            });
        });
    }
}

//# sourceMappingURL=rspack-profiling-plugin.js.map