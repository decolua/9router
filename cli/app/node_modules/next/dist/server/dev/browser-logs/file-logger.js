"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    FileLogger: null,
    getFileLogger: null,
    test__resetFileLogger: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    FileLogger: function() {
        return FileLogger;
    },
    getFileLogger: function() {
        return getFileLogger;
    },
    test__resetFileLogger: function() {
        return test__resetFileLogger;
    }
});
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class FileLogger {
    initialize(distDir, mcpServerEnabled) {
        this.logFilePath = _path.default.join(distDir, 'logs', `next-development.log`);
        this.mcpServerEnabled = mcpServerEnabled;
        if (this.isInitialized) {
            return;
        }
        // Only initialize if mcpServer is enabled
        if (!this.mcpServerEnabled) {
            return;
        }
        try {
            // Clean up the log file on each initialization
            // ensure the directory exists
            _fs.default.mkdirSync(_path.default.dirname(this.logFilePath), {
                recursive: true
            });
            _fs.default.writeFileSync(this.logFilePath, '');
            this.isInitialized = true;
        } catch (error) {
            console.error(error);
        }
    }
    formatTimestamp() {
        // Use performance.now() instead of Date.now() for avoid sync IO of cache components
        const now = performance.now();
        const hours = Math.floor(now / 3600000).toString().padStart(2, '0');
        const minutes = Math.floor(now % 3600000 / 60000).toString().padStart(2, '0');
        const seconds = Math.floor(now % 60000 / 1000).toString().padStart(2, '0');
        const milliseconds = Math.floor(now % 1000).toString().padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    }
    formatLogEntry(entry) {
        const { timestamp, source, level, message } = entry;
        return JSON.stringify({
            timestamp,
            source,
            level,
            message
        }) + '\n';
    }
    scheduleFlush() {
        // Debounce the flush
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        // Delay the log flush to ensure more logs can be batched together asynchronously
        this.flushTimer = setTimeout(()=>{
            this.flush();
        }, 100);
    }
    getLogQueue() {
        return this.logQueue;
    }
    flush() {
        if (this.logQueue.length === 0) {
            return;
        }
        // Only flush to disk if mcpServer is enabled
        if (!this.mcpServerEnabled) {
            this.logQueue.length = 0 // Clear the queue without GC overhead
            ;
            this.flushTimer = null;
            return;
        }
        try {
            // Ensure the directory exists before writing
            const logDir = _path.default.dirname(this.logFilePath);
            if (!_fs.default.existsSync(logDir)) {
                _fs.default.mkdirSync(logDir, {
                    recursive: true
                });
            }
            const logsToWrite = this.logQueue.join('');
            // Writing logs to files synchronously to ensure they're written before returning
            _fs.default.appendFileSync(this.logFilePath, logsToWrite);
            this.logQueue.length = 0 // Clear the queue without GC overhead
            ;
        } catch (error) {
            console.error('Failed to flush logs to file:', error);
        } finally{
            this.flushTimer = null;
        }
    }
    enqueueLog(formattedEntry) {
        this.logQueue.push(formattedEntry);
        // Cancel existing timer and start a new one to ensure all logs are flushed together
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.scheduleFlush();
    }
    log(source, level, message) {
        // Don't log anything if mcpServer is disabled
        if (!this.mcpServerEnabled) {
            return;
        }
        if (!this.isInitialized) {
            return;
        }
        const logEntry = {
            timestamp: this.formatTimestamp(),
            source,
            level,
            message
        };
        const formattedEntry = this.formatLogEntry(logEntry);
        this.enqueueLog(formattedEntry);
    }
    logServer(level, message) {
        this.log('Server', level, message);
    }
    logBrowser(level, message) {
        this.log('Browser', level, message);
    }
    // Force flush all queued logs immediately
    forceFlush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.flush();
    }
    // Cleanup method to flush logs on process exit
    destroy() {
        this.forceFlush();
    }
    constructor(){
        this.logFilePath = '';
        this.isInitialized = false;
        this.logQueue = [];
        this.flushTimer = null;
        this.mcpServerEnabled = false;
    }
}
// Singleton instance
let fileLogger = null;
function getFileLogger() {
    if (!fileLogger || process.env.NODE_ENV === 'test') {
        fileLogger = new FileLogger();
    }
    return fileLogger;
}
function test__resetFileLogger() {
    if (fileLogger) {
        fileLogger.destroy();
    }
    fileLogger = null;
}

//# sourceMappingURL=file-logger.js.map