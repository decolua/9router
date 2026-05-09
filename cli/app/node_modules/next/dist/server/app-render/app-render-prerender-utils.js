"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ReactServerPrerenderResult: null,
    ReactServerResult: null,
    createReactServerPrerenderResult: null,
    createReactServerPrerenderResultFromRender: null,
    processPrelude: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ReactServerPrerenderResult: function() {
        return ReactServerPrerenderResult;
    },
    ReactServerResult: function() {
        return ReactServerResult;
    },
    createReactServerPrerenderResult: function() {
        return createReactServerPrerenderResult;
    },
    createReactServerPrerenderResultFromRender: function() {
        return createReactServerPrerenderResultFromRender;
    },
    processPrelude: function() {
        return processPrelude;
    }
});
const _invarianterror = require("../../shared/lib/invariant-error");
class ReactServerResult {
    constructor(stream){
        this._stream = stream;
    }
    tee() {
        if (this._stream === null) {
            throw Object.defineProperty(new Error('Cannot tee a ReactServerResult that has already been consumed'), "__NEXT_ERROR_CODE", {
                value: "E106",
                enumerable: false,
                configurable: true
            });
        }
        const tee = this._stream.tee();
        this._stream = tee[0];
        return tee[1];
    }
    consume() {
        if (this._stream === null) {
            throw Object.defineProperty(new Error('Cannot consume a ReactServerResult that has already been consumed'), "__NEXT_ERROR_CODE", {
                value: "E470",
                enumerable: false,
                configurable: true
            });
        }
        const stream = this._stream;
        this._stream = null;
        return stream;
    }
}
async function createReactServerPrerenderResult(underlying) {
    const chunks = [];
    const { prelude } = await underlying;
    const reader = prelude.getReader();
    while(true){
        const { done, value } = await reader.read();
        if (done) {
            return new ReactServerPrerenderResult(chunks);
        } else {
            chunks.push(value);
        }
    }
}
async function createReactServerPrerenderResultFromRender(underlying) {
    const chunks = [];
    const reader = underlying.getReader();
    while(true){
        const { done, value } = await reader.read();
        if (done) {
            break;
        } else {
            chunks.push(value);
        }
    }
    return new ReactServerPrerenderResult(chunks);
}
class ReactServerPrerenderResult {
    assertChunks(expression) {
        if (this._chunks === null) {
            throw Object.defineProperty(new _invarianterror.InvariantError(`Cannot \`${expression}\` on a ReactServerPrerenderResult that has already been consumed.`), "__NEXT_ERROR_CODE", {
                value: "E593",
                enumerable: false,
                configurable: true
            });
        }
        return this._chunks;
    }
    consumeChunks(expression) {
        const chunks = this.assertChunks(expression);
        this.consume();
        return chunks;
    }
    consume() {
        this._chunks = null;
    }
    constructor(chunks){
        this._chunks = chunks;
    }
    asUnclosingStream() {
        const chunks = this.assertChunks('asUnclosingStream()');
        return createUnclosingStream(chunks);
    }
    consumeAsUnclosingStream() {
        const chunks = this.consumeChunks('consumeAsUnclosingStream()');
        return createUnclosingStream(chunks);
    }
    asStream() {
        const chunks = this.assertChunks('asStream()');
        return createClosingStream(chunks);
    }
    consumeAsStream() {
        const chunks = this.consumeChunks('consumeAsStream()');
        return createClosingStream(chunks);
    }
}
function createUnclosingStream(chunks) {
    let i = 0;
    return new ReadableStream({
        async pull (controller) {
            if (i < chunks.length) {
                controller.enqueue(chunks[i++]);
            }
        // we intentionally keep the stream open. The consumer will clear
        // out chunks once finished and the remaining memory will be GC'd
        // when this object goes out of scope
        }
    });
}
function createClosingStream(chunks) {
    let i = 0;
    return new ReadableStream({
        async pull (controller) {
            if (i < chunks.length) {
                controller.enqueue(chunks[i++]);
            } else {
                controller.close();
            }
        }
    });
}
async function processPrelude(unprocessedPrelude) {
    const [prelude, peek] = unprocessedPrelude.tee();
    const reader = peek.getReader();
    const firstResult = await reader.read();
    reader.cancel();
    const preludeIsEmpty = firstResult.done === true;
    return {
        prelude,
        preludeIsEmpty
    };
}

//# sourceMappingURL=app-render-prerender-utils.js.map