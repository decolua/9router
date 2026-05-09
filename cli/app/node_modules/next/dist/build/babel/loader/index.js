"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _transform = /*#__PURE__*/ _interop_require_default(require("./transform"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function nextBabelLoader(ctx, parentTrace, inputSource, inputSourceMap) {
    const filename = ctx.resourcePath;
    // Ensure `.d.ts` are not processed.
    if (filename.endsWith('.d.ts')) {
        return [
            inputSource,
            inputSourceMap
        ];
    }
    const target = ctx.target;
    const loaderOptions = parentTrace.traceChild('get-options')// @ts-ignore TODO: remove ignore once webpack 5 types are used
    .traceFn(()=>ctx.getOptions());
    if (loaderOptions.exclude && loaderOptions.exclude(filename)) {
        return [
            inputSource,
            inputSourceMap
        ];
    }
    const loaderSpanInner = parentTrace.traceChild('next-babel-turbo-transform');
    const { code: transformedSource, map: outputSourceMap } = await loaderSpanInner.traceAsyncFn(async ()=>await (0, _transform.default)(ctx, inputSource, inputSourceMap, loaderOptions, filename, target, loaderSpanInner));
    return [
        transformedSource,
        outputSourceMap
    ];
}
function nextBabelLoaderOuter(inputSource, // webpack's source map format is compatible with babel, but the type signature doesn't match
inputSourceMap) {
    const callback = this.async();
    const loaderSpan = this.currentTraceSpan.traceChild('next-babel-turbo-loader');
    loaderSpan.traceAsyncFn(()=>nextBabelLoader(this, loaderSpan, inputSource, inputSourceMap)).then(([transformedSource, outputSourceMap])=>callback == null ? void 0 : callback(/* err */ null, transformedSource, outputSourceMap ?? inputSourceMap), (err)=>{
        callback == null ? void 0 : callback(err);
    });
}
// check this type matches `webpack.LoaderDefinitionFunction`, but be careful
// not to publicly rely on the webpack type since the generated typescript
// declarations will be wrong.
const _nextBabelLoaderOuter = nextBabelLoaderOuter;
const _default = nextBabelLoaderOuter;

//# sourceMappingURL=index.js.map