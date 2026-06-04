"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getServerError", {
    enumerable: true,
    get: function() {
        return getServerError;
    }
});
const _stacktraceparser = require("next/dist/compiled/stacktrace-parser");
const _errorsource = require("../../shared/lib/error-source");
function getFilesystemFrame(frame) {
    const f = {
        ...frame
    };
    if (typeof f.file === 'string') {
        if (// Posix:
        f.file.startsWith('/') || // Win32:
        /^[a-z]:\\/i.test(f.file) || // Win32 UNC:
        f.file.startsWith('\\\\')) {
            f.file = `file://${f.file}`;
        }
    }
    return f;
}
function getServerError(error, type) {
    if (error.name === 'TurbopackInternalError') {
        // If this is an internal Turbopack error we shouldn't show internal details
        // to the user. These are written to a log file instead.
        const turbopackInternalError = Object.defineProperty(new Error('An unexpected Turbopack error occurred. Please see the output of `next dev` for more details.'), "__NEXT_ERROR_CODE", {
            value: "E167",
            enumerable: false,
            configurable: true
        });
        (0, _errorsource.decorateServerError)(turbopackInternalError, type);
        return turbopackInternalError;
    }
    let n;
    try {
        throw Object.defineProperty(new Error(error.message), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    } catch (e) {
        n = e;
    }
    n.name = error.name;
    try {
        n.stack = `${n.toString()}\n${(0, _stacktraceparser.parse)(error.stack).map(getFilesystemFrame).map((f)=>{
            let str = `    at ${f.methodName}`;
            if (f.file) {
                let loc = f.file;
                if (f.lineNumber) {
                    loc += `:${f.lineNumber}`;
                    if (f.column) {
                        loc += `:${f.column}`;
                    }
                }
                str += ` (${loc})`;
            }
            return str;
        }).join('\n')}`;
    } catch  {
        n.stack = error.stack;
    }
    (0, _errorsource.decorateServerError)(n, type);
    return n;
}

//# sourceMappingURL=node-stack-frames.js.map