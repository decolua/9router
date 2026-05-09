"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createNodeStreamFromChunks: null,
    createNodeStreamWithLateRelease: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createNodeStreamFromChunks: function() {
        return createNodeStreamFromChunks;
    },
    createNodeStreamWithLateRelease: function() {
        return createNodeStreamWithLateRelease;
    }
});
const _invarianterror = require("../../../shared/lib/invariant-error");
function createNodeStreamWithLateRelease(partialChunks, allChunks, releaseSignal) {
    if (process.env.NEXT_RUNTIME === 'edge') {
        throw Object.defineProperty(new _invarianterror.InvariantError('createNodeStreamWithLateRelease cannot be used in the edge runtime'), "__NEXT_ERROR_CODE", {
            value: "E993",
            enumerable: false,
            configurable: true
        });
    } else {
        const { Readable } = require('node:stream');
        let nextIndex = 0;
        const readable = new Readable({
            read () {
                while(nextIndex < partialChunks.length){
                    this.push(partialChunks[nextIndex]);
                    nextIndex++;
                }
            }
        });
        releaseSignal.addEventListener('abort', ()=>{
            // Flush any remaining chunks from the original set
            while(nextIndex < partialChunks.length){
                readable.push(partialChunks[nextIndex]);
                nextIndex++;
            }
            // Flush all chunks since we're now aborted and can't schedule
            // any new work but these chunks might unblock debugInfo
            while(nextIndex < allChunks.length){
                readable.push(allChunks[nextIndex]);
                nextIndex++;
            }
            setImmediate(()=>{
                readable.push(null);
            });
        }, {
            once: true
        });
        return readable;
    }
}
function createNodeStreamFromChunks(chunks, signal) {
    if (process.env.NEXT_RUNTIME === 'edge') {
        throw Object.defineProperty(new _invarianterror.InvariantError('createNodeStreamFromChunks cannot be used in the edge runtime'), "__NEXT_ERROR_CODE", {
            value: "E945",
            enumerable: false,
            configurable: true
        });
    } else {
        const { Readable } = require('node:stream');
        // If there's a signal, delay closing until it fires
        if (signal) {
            signal.addEventListener('abort', ()=>{
                readable.push(null);
            }, {
                once: true
            });
        }
        let nextIndex = 0;
        const readable = new Readable({
            read () {
                while(nextIndex < chunks.length){
                    this.push(chunks[nextIndex]);
                    nextIndex++;
                }
                if (!signal) {
                    this.push(null);
                }
            }
        });
        return readable;
    }
}

//# sourceMappingURL=stream-utils.js.map