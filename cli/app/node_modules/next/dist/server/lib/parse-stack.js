"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "parseStack", {
    enumerable: true,
    get: function() {
        return parseStack;
    }
});
const _stacktraceparser = require("next/dist/compiled/stacktrace-parser");
const regexNextStatic = /\/_next(\/static\/.+)/;
function parseStack(stack, distDir = process.env.__NEXT_DIST_DIR) {
    if (!stack) return [];
    // throw away eval information that stacktrace-parser doesn't support
    // adapted from https://github.com/stacktracejs/error-stack-parser/blob/9f33c224b5d7b607755eb277f9d51fcdb7287e24/error-stack-parser.js#L59C33-L59C62
    stack = stack.split('\n').map((line)=>{
        if (line.includes('(eval ')) {
            line = line.replace(/eval code/g, 'eval').replace(/\(eval at [^()]* \(/, '(file://').replace(/\),.*$/g, ')');
        }
        return line;
    }).join('\n');
    const frames = (0, _stacktraceparser.parse)(stack);
    return frames.map((frame)=>{
        try {
            const url = new URL(frame.file);
            const res = regexNextStatic.exec(url.pathname);
            if (res) {
                var _distDir_replace;
                const effectiveDistDir = distDir == null ? void 0 : (_distDir_replace = distDir.replace(/\\/g, '/')) == null ? void 0 : _distDir_replace.replace(/\/$/, '');
                if (effectiveDistDir) {
                    frame.file = 'file://' + effectiveDistDir.concat(res.pop()) + url.search;
                }
            }
        } catch  {}
        return {
            file: frame.file,
            line1: frame.lineNumber,
            column1: frame.column,
            methodName: frame.methodName,
            arguments: frame.arguments
        };
    });
}

//# sourceMappingURL=parse-stack.js.map