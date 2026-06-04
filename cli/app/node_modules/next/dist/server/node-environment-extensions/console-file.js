"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _consoleasyncstorageexternal = require("../app-render/console-async-storage.external");
const _filelogger = require("../dev/browser-logs/file-logger");
const _console = require("../../client/lib/console");
// Based on https://github.com/facebook/react/blob/28dc0776be2e1370fe217549d32aee2519f0cf05/packages/react-server/src/ReactFlightServer.js#L248
function patchConsoleMethodDEV(methodName) {
    const descriptor = Object.getOwnPropertyDescriptor(console, methodName);
    if (descriptor && (descriptor.configurable || descriptor.writable) && typeof descriptor.value === 'function') {
        const originalMethod = descriptor.value;
        const originalName = Object.getOwnPropertyDescriptor(originalMethod, 'name');
        const wrapperMethod = function(...args) {
            const consoleStore = _consoleasyncstorageexternal.consoleAsyncStorage.getStore();
            if ((consoleStore == null ? void 0 : consoleStore.dim) === true) {
                // In this context the log args are already dimmed. We use the console store
                // to decide if this log is ignorable for reporting in our file logger.
                return originalMethod.apply(this, args);
            } else {
                const ret = originalMethod.apply(this, args);
                const fileLogger = (0, _filelogger.getFileLogger)();
                const message = (0, _console.formatConsoleArgs)(args);
                // Strip ANSI escape codes for file logging
                // eslint-disable-next-line no-control-regex
                const ansiEscapeRegex = new RegExp('\u001b\\[[0-9;]*m', 'g');
                const cleanMessage = message.replace(ansiEscapeRegex, '');
                fileLogger.logServer(methodName.toUpperCase(), cleanMessage);
                return ret;
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
if (process.env.NODE_ENV === 'development') {
    patchConsoleMethodDEV('error');
    patchConsoleMethodDEV('assert');
    patchConsoleMethodDEV('debug');
    patchConsoleMethodDEV('dir');
    patchConsoleMethodDEV('dirxml');
    patchConsoleMethodDEV('group');
    patchConsoleMethodDEV('groupCollapsed');
    patchConsoleMethodDEV('groupEnd');
    patchConsoleMethodDEV('info');
    patchConsoleMethodDEV('log');
    patchConsoleMethodDEV('table');
    patchConsoleMethodDEV('trace');
    patchConsoleMethodDEV('warn');
}

//# sourceMappingURL=console-file.js.map