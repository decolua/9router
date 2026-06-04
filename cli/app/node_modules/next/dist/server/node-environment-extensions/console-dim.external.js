"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "setAbortedLogsStyle", {
    enumerable: true,
    get: function() {
        return setAbortedLogsStyle;
    }
});
const _nodeinspector = /*#__PURE__*/ _interop_require_wildcard(require("node:inspector"));
const _picocolors = require("../../lib/picocolors");
const _consoleasyncstorageexternal = require("../app-render/console-async-storage.external");
const _workunitasyncstorageexternal = require("../app-render/work-unit-async-storage.external");
const _runtimereactsexternal = require("../runtime-reacts.external");
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- we may use later and want parity with the HIDDEN_STYLE value
const DIMMED_STYLE = 'dimmed';
const HIDDEN_STYLE = 'hidden';
let currentAbortedLogsStyle = 'dimmed';
function setAbortedLogsStyle(style) {
    currentAbortedLogsStyle = style;
}
const isColorSupported = (0, _picocolors.dim)('test') !== 'test';
// 50% opacity for dimmed text
const dimStyle = 'color: color(from currentColor xyz x y z / 0.5);';
const reactBadgeFormat = '\x1b[0m\x1b[7m%c%s\x1b[0m%c ';
function dimmedConsoleArgs(...inputArgs) {
    if (!isColorSupported) {
        return inputArgs;
    }
    const newArgs = inputArgs.slice(0);
    let template = '';
    let argumentsPointer = 0;
    if (typeof inputArgs[0] === 'string') {
        const originalTemplateString = inputArgs[0];
        // Remove the original template string from the args.
        newArgs.splice(argumentsPointer, 1);
        argumentsPointer += 1;
        let i = 0;
        if (originalTemplateString.startsWith(reactBadgeFormat)) {
            i = reactBadgeFormat.length;
            // for `format` we already moved the pointer earlier
            // style, badge, reset style
            argumentsPointer += 3;
            template += reactBadgeFormat;
            // React's badge reset styles, reapply dimming
            template += '\x1b[2m%c';
            // argumentsPointer includes template
            newArgs.splice(argumentsPointer - 1, 0, dimStyle);
            // dim the badge
            newArgs[0] += `;${dimStyle}`;
        }
        for(i; i < originalTemplateString.length; i++){
            const currentChar = originalTemplateString[i];
            if (currentChar !== '%') {
                template += currentChar;
                continue;
            }
            const nextChar = originalTemplateString[i + 1];
            ++i;
            switch(nextChar){
                case 'f':
                case 'O':
                case 'o':
                case 'd':
                case 's':
                case 'i':
                case 'c':
                    ++argumentsPointer;
                    template += `%${nextChar}`;
                    break;
                default:
                    template += `%${nextChar}`;
            }
        }
    }
    for(argumentsPointer; argumentsPointer < inputArgs.length; ++argumentsPointer){
        const arg = inputArgs[argumentsPointer];
        const argType = typeof arg;
        if (argumentsPointer > 0) {
            template += ' ';
        }
        switch(argType){
            case 'boolean':
            case 'string':
                template += '%s';
                break;
            case 'bigint':
                template += '%s';
                break;
            case 'number':
                if (arg % 0) {
                    template += '%f';
                } else {
                    template += '%d';
                }
                break;
            case 'object':
                template += '%O';
                break;
            case 'symbol':
            case 'undefined':
            case 'function':
                template += '%s';
                break;
            default:
                // deopt to string for new, unknown types
                template += '%s';
        }
    }
    template += '\x1b[22m';
    return [
        (0, _picocolors.dim)(`%c${template}`),
        dimStyle,
        ...newArgs
    ];
}
function convertToDimmedArgs(methodName, args) {
    // When the Node.js inspector is open (e.g. --inspect), skip dimming entirely.
    // Dimming wraps arguments in a format string which defeats inspector
    // affordances such as collapsible objects and clickable/linkified stack
    // traces. Ideally we would only skip dimming when a debugger frontend is
    // actually attached, but Node.js does not expose a synchronous API for that.
    // Detecting would require async polling of the /json/list HTTP endpoint.
    if (_nodeinspector.url() !== undefined) {
        return args;
    }
    switch(methodName){
        case 'dir':
        case 'dirxml':
        case 'group':
        case 'groupCollapsed':
        case 'groupEnd':
        case 'table':
            {
                // These methods cannot be colorized because they don't take a formatting string.
                return args;
            }
        case 'assert':
            {
                // assert takes formatting options as the second argument.
                return [
                    args[0]
                ].concat(...dimmedConsoleArgs(args[1], ...args.slice(2)));
            }
        case 'error':
        case 'debug':
        case 'info':
        case 'log':
        case 'trace':
        case 'warn':
            return dimmedConsoleArgs(args[0], ...args.slice(1));
        default:
            return methodName;
    }
}
// Based on https://github.com/facebook/react/blob/28dc0776be2e1370fe217549d32aee2519f0cf05/packages/react-server/src/ReactFlightServer.js#L248
function patchConsoleMethod(methodName) {
    const descriptor = Object.getOwnPropertyDescriptor(console, methodName);
    if (descriptor && (descriptor.configurable || descriptor.writable) && typeof descriptor.value === 'function') {
        const originalMethod = descriptor.value;
        const originalName = Object.getOwnPropertyDescriptor(originalMethod, 'name');
        const wrapperMethod = function(...args) {
            var _getClientReact, _getServerReact;
            const consoleStore = _consoleasyncstorageexternal.consoleAsyncStorage.getStore();
            // First we see if there is a cache signal for our current scope. If we're in a client render it'll
            // come from the client React cacheSignal implementation. If we are in a server render it'll come from
            // the server React cacheSignal implementation. Any particular console call will be in one, the other, or neither
            // scope and these signals return null if you are out of scope so this can be called from a single global patch
            // and still work properly.
            const signal = ((_getClientReact = (0, _runtimereactsexternal.getClientReact)()) == null ? void 0 : _getClientReact.cacheSignal()) ?? ((_getServerReact = (0, _runtimereactsexternal.getServerReact)()) == null ? void 0 : _getServerReact.cacheSignal());
            if (signal) {
                // We are in a React Server render and can consult the React cache signal to determine if logs
                // are now dimmable.
                if (signal.aborted) {
                    if (currentAbortedLogsStyle === HIDDEN_STYLE) {
                        return;
                    }
                    return applyWithDimming.call(this, consoleStore, originalMethod, methodName, args);
                } else if ((consoleStore == null ? void 0 : consoleStore.dim) === true) {
                    return applyWithDimming.call(this, consoleStore, originalMethod, methodName, args);
                } else {
                    return originalMethod.apply(this, args);
                }
            }
            // We need to fall back to checking the work unit store for two reasons.
            // 1. Client React does not yet implement cacheSignal (it always returns null)
            // 2. route.ts files aren't rendered with React but do have prerender semantics
            // TODO in the future we should be able to remove this once there is a runnable cache
            // scope independent of actual React rendering.
            const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
            switch(workUnitStore == null ? void 0 : workUnitStore.type){
                case 'prerender':
                case 'prerender-runtime':
                // These can be hit in a route handler. In the future we can use potential React.createCache API
                // to create a cache scope for arbitrary computation and can move over to cacheSignal exclusively.
                // fallthrough
                case 'prerender-client':
                case 'validation-client':
                    {
                        // This is a react-dom/server render and won't have a cacheSignal until React adds this for the client world.
                        const renderSignal = workUnitStore.renderSignal;
                        if (renderSignal.aborted) {
                            if (currentAbortedLogsStyle === HIDDEN_STYLE) {
                                return;
                            }
                            return applyWithDimming.call(this, consoleStore, originalMethod, methodName, args);
                        }
                    }
                // intentional fallthrough
                case 'prerender-legacy':
                case 'prerender-ppr':
                case 'cache':
                case 'unstable-cache':
                case 'private-cache':
                case 'request':
                case 'generate-static-params':
                case undefined:
                    if ((consoleStore == null ? void 0 : consoleStore.dim) === true) {
                        return applyWithDimming.call(this, consoleStore, originalMethod, methodName, args);
                    } else {
                        return originalMethod.apply(this, args);
                    }
                default:
                    workUnitStore;
            }
        };
        if (originalName) {
            Object.defineProperty(wrapperMethod, 'name', originalName);
        }
        Object.defineProperty(console, methodName, {
            value: wrapperMethod
        });
    }
}
function applyWithDimming(consoleStore, method, methodName, args) {
    if ((consoleStore == null ? void 0 : consoleStore.dim) === true) {
        return method.apply(this, convertToDimmedArgs(methodName, args));
    } else {
        return _consoleasyncstorageexternal.consoleAsyncStorage.run(DIMMED_STORE, method.bind(this, ...convertToDimmedArgs(methodName, args)));
    }
}
const DIMMED_STORE = {
    dim: true
};
patchConsoleMethod('error');
patchConsoleMethod('assert');
patchConsoleMethod('debug');
patchConsoleMethod('dir');
patchConsoleMethod('dirxml');
patchConsoleMethod('group');
patchConsoleMethod('groupCollapsed');
patchConsoleMethod('groupEnd');
patchConsoleMethod('info');
patchConsoleMethod('log');
patchConsoleMethod('table');
patchConsoleMethod('trace');
patchConsoleMethod('warn');

//# sourceMappingURL=console-dim.external.js.map