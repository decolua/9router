"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    handleClientFileLogs: null,
    handleLog: null,
    receiveBrowserLogsTurbopack: null,
    receiveBrowserLogsWebpack: null,
    restoreUndefined: null,
    stripFormatSpecifiers: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    handleClientFileLogs: function() {
        return handleClientFileLogs;
    },
    handleLog: function() {
        return handleLog;
    },
    receiveBrowserLogsTurbopack: function() {
        return receiveBrowserLogsTurbopack;
    },
    receiveBrowserLogsWebpack: function() {
        return receiveBrowserLogsWebpack;
    },
    restoreUndefined: function() {
        return restoreUndefined;
    },
    stripFormatSpecifiers: function() {
        return stripFormatSpecifiers;
    }
});
const _picocolors = require("../../../lib/picocolors");
const _util = /*#__PURE__*/ _interop_require_default(require("util"));
const _sourcemap = require("./source-map");
const _forwardlogsshared = require("../../../next-devtools/shared/forward-logs-shared");
const _console = require("../../../client/lib/console");
const _filelogger = require("./file-logger");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function restoreUndefined(x) {
    if (x === _forwardlogsshared.UNDEFINED_MARKER) return undefined;
    if (Array.isArray(x)) return x.map(restoreUndefined);
    if (x && typeof x === 'object') {
        for(let k in x){
            x[k] = restoreUndefined(x[k]);
        }
    }
    return x;
}
function cleanConsoleArgsForFileLogging(args) {
    /**
   * Use formatConsoleArgs to strip out background and color format specifiers
   * and keep only the original string content for file logging
   */ try {
        return (0, _console.formatConsoleArgs)(args);
    } catch  {
        // Fallback to simple string conversion if formatting fails
        return args.map((arg)=>typeof arg === 'string' ? arg : _util.default.inspect(arg, {
                depth: 2
            })).join(' ');
    }
}
const methods = [
    'log',
    'info',
    'warn',
    'debug',
    'table',
    'error',
    'assert',
    'dir',
    'dirxml',
    'group',
    'groupCollapsed',
    'groupEnd'
];
const methodsToSkipInspect = new Set([
    'table',
    'dir',
    'dirxml',
    'group',
    'groupCollapsed',
    'groupEnd'
]);
// we aren't overriding console, we're just making a (slightly convoluted) helper for replaying user console methods
const forwardConsole = {
    ...console,
    ...Object.fromEntries(methods.map((method)=>[
            method,
            (...args)=>console[method](...args.map((arg)=>methodsToSkipInspect.has(method) || typeof arg !== 'object' || arg === null ? arg : _util.default.inspect(arg, {
                        depth: Infinity,
                        colors: true
                    })))
        ]))
};
async function deserializeArgData(arg) {
    try {
        // we want undefined to be represented as it would be in the browser from the user's perspective (otherwise it would be stripped away/shown as null)
        if (arg === _forwardlogsshared.UNDEFINED_MARKER) {
            return restoreUndefined(arg);
        }
        return restoreUndefined(JSON.parse(arg));
    } catch  {
        return arg;
    }
}
const colorError = (mapped, config)=>{
    const colorFn = (config == null ? void 0 : config.applyColor) === undefined || config.applyColor ? _picocolors.red : (x)=>x;
    switch(mapped.kind){
        case 'mapped-stack':
        case 'stack':
            {
                return ((config == null ? void 0 : config.prefix) ? colorFn(config == null ? void 0 : config.prefix) : '') + `\n${colorFn(mapped.stack)}`;
            }
        case 'with-frame-code':
            {
                return ((config == null ? void 0 : config.prefix) ? colorFn(config == null ? void 0 : config.prefix) : '') + `\n${colorFn(mapped.stack)}\n${mapped.frameCode}`;
            }
        // a more sophisticated version of this allows the user to config if they want ignored frames (but we need to be sure to source map them)
        case 'all-ignored':
            {
                return (config == null ? void 0 : config.prefix) ? colorFn(config == null ? void 0 : config.prefix) : '';
            }
        default:
            {}
    }
    mapped;
};
function processConsoleFormatStrings(args) {
    /**
   * this handles the case formatting is applied to the console log
   * otherwise we will see the format specifier directly in the terminal output
   */ if (args.length > 0 && typeof args[0] === 'string') {
        const formatString = args[0];
        if (formatString.includes('%s') || formatString.includes('%d') || formatString.includes('%i') || formatString.includes('%f') || formatString.includes('%o') || formatString.includes('%O') || formatString.includes('%c')) {
            try {
                const formatted = _util.default.format(...args);
                return [
                    formatted
                ];
            } catch  {
                return args;
            }
        }
    }
    return args;
}
function stripFormatSpecifiers(args) {
    if (args.length === 0 || typeof args[0] !== 'string') return args;
    const fmtIn = String(args[0]);
    const rest = args.slice(1);
    if (!fmtIn.includes('%')) return args;
    let fmtOut = '';
    let argPtr = 0;
    for(let i = 0; i < fmtIn.length; i++){
        if (fmtIn[i] !== '%') {
            fmtOut += fmtIn[i];
            continue;
        }
        if (fmtIn[i + 1] === '%') {
            fmtOut += '%';
            i++;
            continue;
        }
        const token = fmtIn[++i];
        if (!token) {
            fmtOut += '%';
            continue;
        }
        if ('csdifoOj'.includes(token) || token === 'O') {
            if (argPtr < rest.length) {
                if (token === 'c') {
                    argPtr++;
                } else if (token === 'o' || token === 'O' || token === 'j') {
                    const obj = rest[argPtr++];
                    fmtOut += _util.default.inspect(obj, {
                        depth: 2,
                        colors: false
                    });
                } else {
                    // string(...) is safe for remaining specifiers
                    fmtOut += String(rest[argPtr++]);
                }
            }
            continue;
        }
        fmtOut += '%' + token;
    }
    const result = [
        fmtOut
    ];
    if (argPtr < rest.length) {
        result.push(...rest.slice(argPtr));
    }
    return result;
}
async function prepareFormattedErrorArgs(entry, ctx, distDir) {
    const mapped = await (0, _sourcemap.getSourceMappedStackFrames)(entry.stack, ctx, distDir);
    return [
        colorError(mapped, {
            prefix: entry.prefix
        })
    ];
}
async function prepareConsoleArgs(entry, ctx, distDir) {
    const deserialized = await Promise.all(entry.args.map(async (arg)=>{
        if (arg.kind === 'arg') {
            const data = await deserializeArgData(arg.data);
            if (entry.method === 'warn' && typeof data === 'string') {
                return (0, _picocolors.yellow)(data);
            }
            return data;
        }
        if (!arg.stack) return (0, _picocolors.red)(arg.prefix);
        const mapped = await (0, _sourcemap.getSourceMappedStackFrames)(arg.stack, ctx, distDir);
        return colorError(mapped, {
            prefix: arg.prefix,
            applyColor: false
        });
    }));
    return processConsoleFormatStrings(deserialized);
}
async function prepareConsoleErrorArgs(entry, ctx, distDir) {
    const deserialized = await Promise.all(entry.args.map(async (arg)=>{
        if (arg.kind === 'arg') {
            if (arg.isRejectionMessage) return (0, _picocolors.red)(arg.data);
            return deserializeArgData(arg.data);
        }
        if (!arg.stack) return (0, _picocolors.red)(arg.prefix);
        const mapped = await (0, _sourcemap.getSourceMappedStackFrames)(arg.stack, ctx, distDir);
        return colorError(mapped, {
            prefix: arg.prefix
        });
    }));
    const mappedStack = await (0, _sourcemap.getSourceMappedStackFrames)(entry.consoleErrorStack, ctx, distDir);
    /**
   * don't show the stack + codeblock when there are errors present, since:
   * - it will look overwhelming to see 2 stacks and 2 code blocks
   * - the user already knows where the console.error is at because we append the location
   */ const location = (0, _sourcemap.getConsoleLocation)(mappedStack);
    if (entry.args.some((a)=>a.kind === 'formatted-error-arg')) {
        const result = stripFormatSpecifiers(deserialized);
        if (location) {
            result.push((0, _picocolors.dim)(`(${location})`));
        }
        return result;
    }
    const result = [
        ...processConsoleFormatStrings(deserialized),
        colorError(mappedStack)
    ];
    if (location) {
        result.push((0, _picocolors.dim)(`(${location})`));
    }
    return result;
}
async function handleTable(entry, browserPrefix, ctx, distDir) {
    const deserializedArgs = await Promise.all(entry.args.map(async (arg)=>{
        if (arg.kind === 'formatted-error-arg') {
            return {
                stack: arg.stack
            };
        }
        return deserializeArgData(arg.data);
    }));
    const location = await (async ()=>{
        if (!entry.consoleMethodStack) {
            return;
        }
        const frames = await (0, _sourcemap.getSourceMappedStackFrames)(entry.consoleMethodStack, ctx, distDir);
        return (0, _sourcemap.getConsoleLocation)(frames);
    })();
    // we can't inline pass browser prefix, but it looks better multiline for table anyways
    forwardConsole.log(browserPrefix);
    forwardConsole.table(...deserializedArgs);
    if (location) {
        forwardConsole.log((0, _picocolors.dim)(`(${location})`));
    }
}
async function handleTrace(entry, browserPrefix, ctx, distDir) {
    const deserializedArgs = await Promise.all(entry.args.map(async (arg)=>{
        if (arg.kind === 'formatted-error-arg') {
            if (!arg.stack) return (0, _picocolors.red)(arg.prefix);
            const mapped = await (0, _sourcemap.getSourceMappedStackFrames)(arg.stack, ctx, distDir);
            return colorError(mapped, {
                prefix: arg.prefix
            });
        }
        return deserializeArgData(arg.data);
    }));
    if (!entry.consoleMethodStack) {
        forwardConsole.log(browserPrefix, ...deserializedArgs, '[Trace unavailable]');
        return;
    }
    // TODO(rob): refactor so we can re-use result and not re-run the entire source map to avoid trivial post processing
    const [mapped, mappedIgnored] = await Promise.all([
        (0, _sourcemap.getSourceMappedStackFrames)(entry.consoleMethodStack, ctx, distDir, false),
        (0, _sourcemap.getSourceMappedStackFrames)(entry.consoleMethodStack, ctx, distDir)
    ]);
    const location = (0, _sourcemap.getConsoleLocation)(mappedIgnored);
    forwardConsole.log(browserPrefix, ...deserializedArgs, `\n${mapped.stack}`, ...location ? [
        `\n${(0, _picocolors.dim)(`(${location})`)}`
    ] : []);
}
async function handleDir(entry, browserPrefix, ctx, distDir) {
    const loggableEntry = await prepareConsoleArgs(entry, ctx, distDir);
    const consoleMethod = forwardConsole[entry.method] || forwardConsole.log;
    if (entry.consoleMethodStack) {
        const mapped = await (0, _sourcemap.getSourceMappedStackFrames)(entry.consoleMethodStack, ctx, distDir);
        const location = (0, _picocolors.dim)(`(${(0, _sourcemap.getConsoleLocation)(mapped)})`);
        const originalWrite = process.stdout.write.bind(process.stdout);
        let captured = '';
        process.stdout.write = (chunk)=>{
            captured += chunk;
            return true;
        };
        try {
            consoleMethod(...loggableEntry);
        } finally{
            process.stdout.write = originalWrite;
        }
        const preserved = captured.replace(/\r?\n$/, '');
        originalWrite(`${browserPrefix}${preserved} ${location}\n`);
        return;
    }
    consoleMethod(browserPrefix, ...loggableEntry);
}
async function handleDefaultConsole(entry, browserPrefix, ctx, distDir, config, isServerLog) {
    const consoleArgs = await prepareConsoleArgs(entry, ctx, distDir);
    const withStackEntry = await (0, _sourcemap.withLocation)({
        original: consoleArgs,
        stack: entry.consoleMethodStack || null
    }, ctx, distDir, config);
    const consoleMethod = forwardConsole[entry.method] || forwardConsole.log;
    consoleMethod(browserPrefix, ...withStackEntry);
    // Process enqueued logs and write to file
    // Log to file with correct source based on context
    const fileLogger = (0, _filelogger.getFileLogger)();
    // Use cleaned console args to strip out background and color format specifiers
    const message = cleanConsoleArgsForFileLogging(consoleArgs);
    if (isServerLog) {
        fileLogger.logServer(entry.method.toUpperCase(), message);
    } else {
        fileLogger.logBrowser(entry.method.toUpperCase(), message);
    }
}
// Log levels from most severe to least severe
// Lower index = more severe
const LOG_LEVEL_PRIORITY = {
    error: 0,
    warn: 1,
    verbose: 2
};
// Map console methods to log levels
const METHOD_TO_LEVEL = {
    error: 'error',
    warn: 'warn',
    info: 'verbose',
    log: 'verbose',
    debug: 'verbose',
    table: 'verbose',
    trace: 'verbose',
    dir: 'verbose',
    dirxml: 'verbose',
    assert: 'error',
    group: 'verbose',
    groupCollapsed: 'verbose',
    groupEnd: 'verbose'
};
function shouldShowEntry(entry, config) {
    // If config is false, don't show any entries
    if (config === false) {
        return false;
    }
    // Determine the effective minimum log level
    const minLevel = typeof config === 'string' ? config : 'verbose' // true means show everything
    ;
    const minPriority = LOG_LEVEL_PRIORITY[minLevel];
    // formatted-error and any-logged-error are always treated as errors
    if (entry.kind === 'formatted-error' || entry.kind === 'any-logged-error') {
        return LOG_LEVEL_PRIORITY['error'] <= minPriority;
    }
    if (entry.kind === 'console') {
        const entryLevel = METHOD_TO_LEVEL[entry.method] || 'log';
        return LOG_LEVEL_PRIORITY[entryLevel] <= minPriority;
    }
    return false;
}
async function handleLog(entries, ctx, distDir, config) {
    // Determine the source based on the context
    const isServerLog = ctx.isServer || ctx.isEdgeServer;
    const browserPrefix = isServerLog ? (0, _picocolors.cyan)('[server]') : (0, _picocolors.cyan)('[browser]');
    const fileLogger = (0, _filelogger.getFileLogger)();
    for (const entry of entries){
        // Filter entries based on config mode
        if (!shouldShowEntry(entry, config)) {
            continue;
        }
        try {
            switch(entry.kind){
                case 'console':
                    {
                        switch(entry.method){
                            case 'table':
                                {
                                    // timeout based abort on source mapping result
                                    await handleTable(entry, browserPrefix, ctx, distDir);
                                    break;
                                }
                            // ignore frames
                            case 'trace':
                                {
                                    await handleTrace(entry, browserPrefix, ctx, distDir);
                                    break;
                                }
                            case 'dir':
                                {
                                    await handleDir(entry, browserPrefix, ctx, distDir);
                                    break;
                                }
                            case 'dirxml':
                                {
                                // xml log thing maybe needs an impl
                                // fallthrough
                                }
                            case 'group':
                            case 'groupCollapsed':
                            case 'groupEnd':
                                {
                                // [browser] undefined (app/page.tsx:8:11) console.group
                                // fallthrough
                                }
                            case 'assert':
                                {
                                // check console assert
                                // fallthrough
                                }
                            case 'log':
                            case 'info':
                            case 'debug':
                            case 'error':
                            case 'warn':
                                {
                                    await handleDefaultConsole(entry, browserPrefix, ctx, distDir, config, isServerLog);
                                    break;
                                }
                            default:
                                {
                                    entry;
                                }
                        }
                        break;
                    }
                // any logged errors are anything that are logged as "red" in the browser but aren't only an Error (console.error, Promise.reject(100))
                case 'any-logged-error':
                    {
                        const consoleArgs = await prepareConsoleErrorArgs(entry, ctx, distDir);
                        forwardConsole.error(browserPrefix, ...consoleArgs);
                        // Process enqueued logs and write to file
                        fileLogger.logBrowser('ERROR', cleanConsoleArgsForFileLogging(consoleArgs));
                        break;
                    }
                // formatted error is an explicit error event (rejections, uncaught errors)
                case 'formatted-error':
                    {
                        const formattedArgs = await prepareFormattedErrorArgs(entry, ctx, distDir);
                        forwardConsole.error(browserPrefix, ...formattedArgs);
                        // Process enqueued logs and write to file
                        fileLogger.logBrowser('ERROR', cleanConsoleArgsForFileLogging(formattedArgs));
                        break;
                    }
                default:
                    {}
            }
        } catch  {
            switch(entry.kind){
                case 'any-logged-error':
                    {
                        const consoleArgs = await prepareConsoleErrorArgs(entry, ctx, distDir);
                        forwardConsole.error(browserPrefix, ...consoleArgs);
                        // Process enqueued logs and write to file
                        fileLogger.logBrowser('ERROR', cleanConsoleArgsForFileLogging(consoleArgs));
                        break;
                    }
                case 'console':
                    {
                        const consoleMethod = forwardConsole[entry.method] || forwardConsole.log;
                        const consoleArgs = await prepareConsoleArgs(entry, ctx, distDir);
                        consoleMethod(browserPrefix, ...consoleArgs);
                        // Process enqueued logs and write to file
                        fileLogger.logBrowser('ERROR', cleanConsoleArgsForFileLogging(consoleArgs));
                        break;
                    }
                case 'formatted-error':
                    {
                        forwardConsole.error(browserPrefix, `${entry.prefix}\n`, entry.stack);
                        // Process enqueued logs and write to file
                        fileLogger.logBrowser('ERROR', cleanConsoleArgsForFileLogging([
                            `${entry.prefix}\n${entry.stack}`
                        ]));
                        break;
                    }
                default:
                    {}
            }
        }
    }
}
async function receiveBrowserLogsWebpack(opts) {
    const { entries, router, sourceType, clientStats, serverStats, edgeServerStats, rootDirectory, distDir } = opts;
    const isAppDirectory = router === 'app';
    const isServer = sourceType === 'server';
    const isEdgeServer = sourceType === 'edge-server';
    const ctx = {
        bundler: 'webpack',
        isServer,
        isEdgeServer,
        isAppDirectory,
        clientStats,
        serverStats,
        edgeServerStats,
        rootDirectory
    };
    await handleLog(entries, ctx, distDir, opts.config);
}
async function receiveBrowserLogsTurbopack(opts) {
    const { entries, router, sourceType, project, projectPath, distDir } = opts;
    const isAppDirectory = router === 'app';
    const isServer = sourceType === 'server';
    const isEdgeServer = sourceType === 'edge-server';
    const ctx = {
        bundler: 'turbopack',
        project,
        projectPath,
        isServer,
        isEdgeServer,
        isAppDirectory
    };
    await handleLog(entries, ctx, distDir, opts.config);
}
async function handleClientFileLogs(logs) {
    const fileLogger = (0, _filelogger.getFileLogger)();
    for (const log of logs){
        fileLogger.logBrowser(log.level, log.message);
    }
}

//# sourceMappingURL=receive-logs.js.map