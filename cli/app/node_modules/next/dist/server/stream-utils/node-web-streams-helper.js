"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    chainStreams: null,
    continueDynamicHTMLResume: null,
    continueDynamicPrerender: null,
    continueFizzStream: null,
    continueStaticFallbackPrerender: null,
    continueStaticPrerender: null,
    createBufferedTransformStream: null,
    createDocumentClosingStream: null,
    createInstantTestScriptInsertionTransformStream: null,
    createRootLayoutValidatorStream: null,
    createRuntimePrefetchTransformStream: null,
    renderToInitialFizzStream: null,
    streamFromBuffer: null,
    streamFromString: null,
    streamToBuffer: null,
    streamToString: null,
    streamToUint8Array: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    chainStreams: function() {
        return chainStreams;
    },
    continueDynamicHTMLResume: function() {
        return continueDynamicHTMLResume;
    },
    continueDynamicPrerender: function() {
        return continueDynamicPrerender;
    },
    continueFizzStream: function() {
        return continueFizzStream;
    },
    continueStaticFallbackPrerender: function() {
        return continueStaticFallbackPrerender;
    },
    continueStaticPrerender: function() {
        return continueStaticPrerender;
    },
    createBufferedTransformStream: function() {
        return createBufferedTransformStream;
    },
    createDocumentClosingStream: function() {
        return createDocumentClosingStream;
    },
    createInstantTestScriptInsertionTransformStream: function() {
        return createInstantTestScriptInsertionTransformStream;
    },
    createRootLayoutValidatorStream: function() {
        return createRootLayoutValidatorStream;
    },
    createRuntimePrefetchTransformStream: function() {
        return createRuntimePrefetchTransformStream;
    },
    renderToInitialFizzStream: function() {
        return renderToInitialFizzStream;
    },
    streamFromBuffer: function() {
        return streamFromBuffer;
    },
    streamFromString: function() {
        return streamFromString;
    },
    streamToBuffer: function() {
        return streamToBuffer;
    },
    streamToString: function() {
        return streamToString;
    },
    streamToUint8Array: function() {
        return streamToUint8Array;
    }
});
const _tracer = require("../lib/trace/tracer");
const _constants = require("../lib/trace/constants");
const _detachedpromise = require("../../lib/detached-promise");
const _scheduler = require("../../lib/scheduler");
const _encodedtags = require("./encoded-tags");
const _uint8arrayhelpers = require("./uint8array-helpers");
const _constants1 = require("../../shared/lib/errors/constants");
const _approuterheaders = require("../../client/components/app-router-headers");
const _cachebustingsearchparam = require("../../shared/lib/router/utils/cache-busting-search-param");
function voidCatch() {
// this catcher is designed to be used with pipeTo where we expect the underlying
// pipe implementation to forward errors but we don't want the pipeTo promise to reject
// and be unhandled
}
// We can share the same encoder instance everywhere
// Notably we cannot do the same for TextDecoder because it is stateful
// when handling streaming data
const encoder = new TextEncoder();
function chainStreams(...streams) {
    // If we have no streams, return an empty stream. This behavior is
    // intentional as we're now providing the `RenderResult.EMPTY` value.
    if (streams.length === 0) {
        return new ReadableStream({
            start (controller) {
                controller.close();
            }
        });
    }
    // If we only have 1 stream we fast path it by returning just this stream
    if (streams.length === 1) {
        return streams[0];
    }
    const { readable, writable } = new TransformStream();
    // We always initiate pipeTo immediately. We know we have at least 2 streams
    // so we need to avoid closing the writable when this one finishes.
    let promise = streams[0].pipeTo(writable, {
        preventClose: true
    });
    let i = 1;
    for(; i < streams.length - 1; i++){
        const nextStream = streams[i];
        promise = promise.then(()=>nextStream.pipeTo(writable, {
                preventClose: true
            }));
    }
    // We can omit the length check because we halted before the last stream and there
    // is at least two streams so the lastStream here will always be defined
    const lastStream = streams[i];
    promise = promise.then(()=>lastStream.pipeTo(writable));
    // Catch any errors from the streams and ignore them, they will be handled
    // by whatever is consuming the readable stream.
    promise.catch(voidCatch);
    return readable;
}
function streamFromString(str) {
    return new ReadableStream({
        start (controller) {
            controller.enqueue(encoder.encode(str));
            controller.close();
        }
    });
}
function streamFromBuffer(chunk) {
    return new ReadableStream({
        start (controller) {
            controller.enqueue(chunk);
            controller.close();
        }
    });
}
async function streamToChunks(stream) {
    const reader = stream.getReader();
    const chunks = [];
    while(true){
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
    }
    return chunks;
}
function concatUint8Arrays(chunks) {
    const totalLength = chunks.reduce((sum, chunk)=>sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks){
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}
async function streamToUint8Array(stream) {
    return concatUint8Arrays(await streamToChunks(stream));
}
async function streamToBuffer(stream) {
    return Buffer.concat(await streamToChunks(stream));
}
async function streamToString(stream, signal) {
    const decoder = new TextDecoder('utf-8', {
        fatal: true
    });
    let string = '';
    for await (const chunk of stream){
        if (signal == null ? void 0 : signal.aborted) {
            return string;
        }
        string += decoder.decode(chunk, {
            stream: true
        });
    }
    string += decoder.decode();
    return string;
}
function createBufferedTransformStream(options = {}) {
    const { maxBufferByteLength = Infinity } = options;
    let bufferedChunks = [];
    let bufferByteLength = 0;
    let pending;
    const flush = (controller)=>{
        try {
            if (bufferedChunks.length === 0) {
                return;
            }
            const chunk = new Uint8Array(bufferByteLength);
            let copiedBytes = 0;
            for(let i = 0; i < bufferedChunks.length; i++){
                const bufferedChunk = bufferedChunks[i];
                chunk.set(bufferedChunk, copiedBytes);
                copiedBytes += bufferedChunk.byteLength;
            }
            // We just wrote all the buffered chunks so we need to reset the bufferedChunks array
            // and our bufferByteLength to prepare for the next round of buffered chunks
            bufferedChunks.length = 0;
            bufferByteLength = 0;
            controller.enqueue(chunk);
        } catch  {
        // If an error occurs while enqueuing, it can't be due to this
        // transformer. It's most likely caused by the controller having been
        // errored (for example, if the stream was cancelled).
        }
    };
    const scheduleFlush = (controller)=>{
        if (pending) {
            return;
        }
        const detached = new _detachedpromise.DetachedPromise();
        pending = detached;
        (0, _scheduler.scheduleImmediate)(()=>{
            try {
                flush(controller);
            } finally{
                pending = undefined;
                detached.resolve();
            }
        });
    };
    return new TransformStream({
        transform (chunk, controller) {
            // Combine the previous buffer with the new chunk.
            bufferedChunks.push(chunk);
            bufferByteLength += chunk.byteLength;
            if (bufferByteLength >= maxBufferByteLength) {
                flush(controller);
            } else {
                scheduleFlush(controller);
            }
        },
        flush () {
            return pending == null ? void 0 : pending.promise;
        }
    });
}
function renderToInitialFizzStream({ ReactDOMServer, element, streamOptions }) {
    return (0, _tracer.getTracer)().trace(_constants.AppRenderSpan.renderToReadableStream, async ()=>ReactDOMServer.renderToReadableStream(element, streamOptions));
}
function createMetadataTransformStream(insert) {
    let chunkIndex = -1;
    let isMarkRemoved = false;
    return new TransformStream({
        async transform (chunk, controller) {
            let iconMarkIndex = -1;
            let closedHeadIndex = -1;
            chunkIndex++;
            if (isMarkRemoved) {
                controller.enqueue(chunk);
                return;
            }
            let iconMarkLength = 0;
            // Only search for the closed head tag once
            if (iconMarkIndex === -1) {
                iconMarkIndex = (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.META.ICON_MARK);
                if (iconMarkIndex === -1) {
                    controller.enqueue(chunk);
                    return;
                } else {
                    // When we found the `<meta name="«nxt-icon»"` tag prefix, we will remove it from the chunk.
                    // Its close tag could either be `/>` or `>`, checking the next char to ensure we cover both cases.
                    iconMarkLength = _encodedtags.ENCODED_TAGS.META.ICON_MARK.length;
                    // Check if next char is /, this is for xml mode.
                    if (chunk[iconMarkIndex + iconMarkLength] === 47) {
                        iconMarkLength += 2;
                    } else {
                        // The last char is `>`
                        iconMarkLength++;
                    }
                }
            }
            // Check if icon mark is inside <head> tag in the first chunk.
            if (chunkIndex === 0) {
                closedHeadIndex = (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.HEAD);
                if (iconMarkIndex !== -1) {
                    // The mark icon is located in the 1st chunk before the head tag.
                    // We do not need to insert the script tag in this case because it's in the head.
                    // Just remove the icon mark from the chunk.
                    if (iconMarkIndex < closedHeadIndex) {
                        const replaced = new Uint8Array(chunk.length - iconMarkLength);
                        // Remove the icon mark from the chunk.
                        replaced.set(chunk.subarray(0, iconMarkIndex));
                        replaced.set(chunk.subarray(iconMarkIndex + iconMarkLength), iconMarkIndex);
                        chunk = replaced;
                    } else {
                        // The icon mark is after the head tag, replace and insert the script tag at that position.
                        const insertion = await insert();
                        const encodedInsertion = encoder.encode(insertion);
                        const insertionLength = encodedInsertion.length;
                        const replaced = new Uint8Array(chunk.length - iconMarkLength + insertionLength);
                        replaced.set(chunk.subarray(0, iconMarkIndex));
                        replaced.set(encodedInsertion, iconMarkIndex);
                        replaced.set(chunk.subarray(iconMarkIndex + iconMarkLength), iconMarkIndex + insertionLength);
                        chunk = replaced;
                    }
                    isMarkRemoved = true;
                }
            // If there's no icon mark located, it will be handled later when if present in the following chunks.
            } else {
                // When it's appeared in the following chunks, we'll need to
                // remove the mark and then insert the script tag at that position.
                const insertion = await insert();
                const encodedInsertion = encoder.encode(insertion);
                const insertionLength = encodedInsertion.length;
                // Replace the icon mark with the hoist script or empty string.
                const replaced = new Uint8Array(chunk.length - iconMarkLength + insertionLength);
                // Set the first part of the chunk, before the icon mark.
                replaced.set(chunk.subarray(0, iconMarkIndex));
                // Set the insertion after the icon mark.
                replaced.set(encodedInsertion, iconMarkIndex);
                // Set the rest of the chunk after the icon mark.
                replaced.set(chunk.subarray(iconMarkIndex + iconMarkLength), iconMarkIndex + insertionLength);
                chunk = replaced;
                isMarkRemoved = true;
            }
            controller.enqueue(chunk);
        }
    });
}
function createHeadInsertionTransformStream(insert) {
    let inserted = false;
    // We need to track if this transform saw any bytes because if it didn't
    // we won't want to insert any server HTML at all
    let hasBytes = false;
    return new TransformStream({
        async transform (chunk, controller) {
            hasBytes = true;
            const insertion = await insert();
            if (inserted) {
                if (insertion) {
                    const encodedInsertion = encoder.encode(insertion);
                    controller.enqueue(encodedInsertion);
                }
                controller.enqueue(chunk);
            } else {
                // TODO (@Ethan-Arrowood): Replace the generic `indexOfUint8Array` method with something finely tuned for the subset of things actually being checked for.
                const index = (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.HEAD);
                // In fully static rendering or non PPR rendering cases:
                // `/head>` will always be found in the chunk in first chunk rendering.
                if (index !== -1) {
                    if (insertion) {
                        const encodedInsertion = encoder.encode(insertion);
                        // Get the total count of the bytes in the chunk and the insertion
                        // e.g.
                        // chunk = <head><meta charset="utf-8"></head>
                        // insertion = <script>...</script>
                        // output = <head><meta charset="utf-8"> [ <script>...</script> ] </head>
                        const insertedHeadContent = new Uint8Array(chunk.length + encodedInsertion.length);
                        // Append the first part of the chunk, before the head tag
                        insertedHeadContent.set(chunk.slice(0, index));
                        // Append the server inserted content
                        insertedHeadContent.set(encodedInsertion, index);
                        // Append the rest of the chunk
                        insertedHeadContent.set(chunk.slice(index), index + encodedInsertion.length);
                        controller.enqueue(insertedHeadContent);
                    } else {
                        controller.enqueue(chunk);
                    }
                    inserted = true;
                } else {
                    // This will happens in PPR rendering during next start, when the page is partially rendered.
                    // When the page resumes, the head tag will be found in the middle of the chunk.
                    // Where we just need to append the insertion and chunk to the current stream.
                    // e.g.
                    // PPR-static: <head>...</head><body> [ resume content ] </body>
                    // PPR-resume: [ insertion ] [ rest content ]
                    if (insertion) {
                        controller.enqueue(encoder.encode(insertion));
                    }
                    controller.enqueue(chunk);
                    inserted = true;
                }
            }
        },
        async flush (controller) {
            // Check before closing if there's anything remaining to insert.
            if (hasBytes) {
                const insertion = await insert();
                if (insertion) {
                    controller.enqueue(encoder.encode(insertion));
                }
            }
        }
    });
}
function createClientResumeScriptInsertionTransformStream() {
    const segmentPath = '/_full';
    const cacheBustingHeader = (0, _cachebustingsearchparam.computeCacheBustingSearchParam)('1', '/_full', undefined, undefined //       headers[NEXT_URL]
    );
    const searchStr = `${_approuterheaders.NEXT_RSC_UNION_QUERY}=${cacheBustingHeader}`;
    const NEXT_CLIENT_RESUME_SCRIPT = `<script>__NEXT_CLIENT_RESUME=fetch(location.pathname+'?${searchStr}',{credentials:'same-origin',headers:{'${_approuterheaders.RSC_HEADER}': '1','${_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER}': '1','${_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER}': '${segmentPath}'}})</script>`;
    let didAlreadyInsert = false;
    return new TransformStream({
        transform (chunk, controller) {
            if (didAlreadyInsert) {
                // Already inserted the script into the head. Pass through.
                controller.enqueue(chunk);
                return;
            }
            // TODO (@Ethan-Arrowood): Replace the generic `indexOfUint8Array` method with something finely tuned for the subset of things actually being checked for.
            const headClosingTagIndex = (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.HEAD);
            if (headClosingTagIndex === -1) {
                // In fully static rendering or non PPR rendering cases:
                // `/head>` will always be found in the chunk in first chunk rendering.
                controller.enqueue(chunk);
                return;
            }
            const encodedInsertion = encoder.encode(NEXT_CLIENT_RESUME_SCRIPT);
            // Get the total count of the bytes in the chunk and the insertion
            // e.g.
            // chunk = <head><meta charset="utf-8"></head>
            // insertion = <script>...</script>
            // output = <head><meta charset="utf-8"> [ <script>...</script> ] </head>
            const insertedHeadContent = new Uint8Array(chunk.length + encodedInsertion.length);
            // Append the first part of the chunk, before the head tag
            insertedHeadContent.set(chunk.slice(0, headClosingTagIndex));
            // Append the server inserted content
            insertedHeadContent.set(encodedInsertion, headClosingTagIndex);
            // Append the rest of the chunk
            insertedHeadContent.set(chunk.slice(headClosingTagIndex), headClosingTagIndex + encodedInsertion.length);
            controller.enqueue(insertedHeadContent);
            didAlreadyInsert = true;
        }
    });
}
function createInstantTestScriptInsertionTransformStream(requestId) {
    // Kick off a fetch for the static RSC payload. This is the hydration
    // source for the locked static shell — same as the __NEXT_CLIENT_RESUME
    // fetch used for fallback routes, but with NEXT_INSTANT_PREFETCH_HEADER
    // so the server returns static-only data.
    //
    // The fetch promise is stored as self.__next_instant_test, which doubles
    // as the feature flag (truthy = instant test mode). The client processes
    // this as a fallback prerender payload for hydration.
    const segmentPath = '/_full';
    const cacheBustingHeader = (0, _cachebustingsearchparam.computeCacheBustingSearchParam)('1', segmentPath, undefined, undefined);
    const searchStr = `${_approuterheaders.NEXT_RSC_UNION_QUERY}=${cacheBustingHeader}`;
    // In dev mode, inject self.__next_r (request ID) so that HMR WebSocket
    // and debug channel initialization don't crash. The static shell
    // bypasses renderToFizzStream which normally injects this via
    // bootstrapScriptContent.
    const requestIdScript = requestId !== null ? `self.__next_r=${JSON.stringify(requestId)};` : '';
    const INSTANT_TEST_SCRIPT = `<script>${requestIdScript}self.__next_instant_test=fetch(location.pathname+'?${searchStr}',{credentials:'same-origin',headers:{'${_approuterheaders.RSC_HEADER}':'1','${_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER}':'1','${_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER}':'${segmentPath}','${_approuterheaders.NEXT_INSTANT_PREFETCH_HEADER}':'1'}})</script>`;
    let didAlreadyInsert = false;
    return new TransformStream({
        transform (chunk, controller) {
            if (didAlreadyInsert) {
                // Already inserted the script into the head. Pass through.
                controller.enqueue(chunk);
                return;
            }
            // Find the opening <head tag (may have attributes like <head class="...">)
            const headOpenIndex = (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.OPENING.HEAD);
            if (headOpenIndex === -1) {
                controller.enqueue(chunk);
                return;
            }
            // Find the closing > of the <head ...> tag
            const headCloseAngle = chunk.indexOf(62, headOpenIndex + _encodedtags.ENCODED_TAGS.OPENING.HEAD.length);
            if (headCloseAngle === -1) {
                controller.enqueue(chunk);
                return;
            }
            const encodedInsertion = encoder.encode(INSTANT_TEST_SCRIPT);
            const insertionPoint = headCloseAngle + 1;
            // e.g.
            // chunk = <!DOCTYPE html><html><head><meta charset="utf-8">...
            // insertion = <script>self.__next_instant_test=fetch(...)</script>
            // output = <!DOCTYPE html><html><head> [ <script>...</script> ] <meta charset="utf-8">...
            const insertedHeadContent = new Uint8Array(chunk.length + encodedInsertion.length);
            insertedHeadContent.set(chunk.slice(0, insertionPoint));
            insertedHeadContent.set(encodedInsertion, insertionPoint);
            insertedHeadContent.set(chunk.slice(insertionPoint), insertionPoint + encodedInsertion.length);
            controller.enqueue(insertedHeadContent);
            didAlreadyInsert = true;
        },
        flush (controller) {
            // Append closing tags so the browser can parse the full document.
            controller.enqueue(_encodedtags.ENCODED_TAGS.CLOSED.BODY_AND_HTML);
        }
    });
}
// Suffix after main body content - scripts before </body>,
// but wait for the major chunks to be enqueued.
function createDeferredSuffixStream(suffix) {
    let flushed = false;
    let pending;
    const flush = (controller)=>{
        const detached = new _detachedpromise.DetachedPromise();
        pending = detached;
        (0, _scheduler.scheduleImmediate)(()=>{
            try {
                controller.enqueue(encoder.encode(suffix));
            } catch  {
            // If an error occurs while enqueuing it can't be due to this
            // transformers fault. It's likely due to the controller being
            // errored due to the stream being cancelled.
            } finally{
                pending = undefined;
                detached.resolve();
            }
        });
    };
    return new TransformStream({
        transform (chunk, controller) {
            controller.enqueue(chunk);
            // If we've already flushed, we're done.
            if (flushed) return;
            // Schedule the flush to happen.
            flushed = true;
            flush(controller);
        },
        flush (controller) {
            if (pending) return pending.promise;
            if (flushed) return;
            // Flush now.
            controller.enqueue(encoder.encode(suffix));
        }
    });
}
function createFlightDataInjectionTransformStream(stream, delayDataUntilFirstHtmlChunk) {
    let htmlStreamFinished = false;
    let pull = null;
    let donePulling = false;
    function startOrContinuePulling(controller) {
        if (!pull) {
            pull = startPulling(controller);
        }
        return pull;
    }
    async function startPulling(controller) {
        const reader = stream.getReader();
        if (delayDataUntilFirstHtmlChunk) {
            // NOTE: streaming flush
            // We are buffering here for the inlined data stream because the
            // "shell" stream might be chunkenized again by the underlying stream
            // implementation, e.g. with a specific high-water mark. To ensure it's
            // the safe timing to pipe the data stream, this extra tick is
            // necessary.
            // We don't start reading until we've left the current Task to ensure
            // that it's inserted after flushing the shell. Note that this implementation
            // might get stale if impl details of Fizz change in the future.
            await (0, _scheduler.atLeastOneTask)();
        }
        try {
            while(true){
                const { done, value } = await reader.read();
                if (done) {
                    donePulling = true;
                    return;
                }
                // We want to prioritize HTML over RSC data.
                // The SSR render is based on the same RSC stream, so when we get a new RSC chunk,
                // we're likely to produce an HTML chunk as well, so give it a chance to flush first.
                if (!delayDataUntilFirstHtmlChunk && !htmlStreamFinished) {
                    await (0, _scheduler.atLeastOneTask)();
                }
                controller.enqueue(value);
            }
        } catch (err) {
            controller.error(err);
        }
    }
    return new TransformStream({
        start (controller) {
            if (!delayDataUntilFirstHtmlChunk) {
                startOrContinuePulling(controller);
            }
        },
        transform (chunk, controller) {
            controller.enqueue(chunk);
            // Start the streaming if it hasn't already been started yet.
            if (delayDataUntilFirstHtmlChunk) {
                startOrContinuePulling(controller);
            }
        },
        flush (controller) {
            htmlStreamFinished = true;
            if (donePulling) {
                return;
            }
            return startOrContinuePulling(controller);
        }
    });
}
const CLOSE_TAG = '</body></html>';
/**
 * This transform stream moves the suffix to the end of the stream, so results
 * like `</body></html><script>...</script>` will be transformed to
 * `<script>...</script></body></html>`.
 */ function createMoveSuffixStream() {
    let foundSuffix = false;
    return new TransformStream({
        transform (chunk, controller) {
            if (foundSuffix) {
                return controller.enqueue(chunk);
            }
            const index = (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.BODY_AND_HTML);
            if (index > -1) {
                foundSuffix = true;
                // If the whole chunk is the suffix, then don't write anything, it will
                // be written in the flush.
                if (chunk.length === _encodedtags.ENCODED_TAGS.CLOSED.BODY_AND_HTML.length) {
                    return;
                }
                // Write out the part before the suffix.
                const before = chunk.slice(0, index);
                controller.enqueue(before);
                // In the case where the suffix is in the middle of the chunk, we need
                // to split the chunk into two parts.
                if (chunk.length > _encodedtags.ENCODED_TAGS.CLOSED.BODY_AND_HTML.length + index) {
                    // Write out the part after the suffix.
                    const after = chunk.slice(index + _encodedtags.ENCODED_TAGS.CLOSED.BODY_AND_HTML.length);
                    controller.enqueue(after);
                }
            } else {
                controller.enqueue(chunk);
            }
        },
        flush (controller) {
            // Even if we didn't find the suffix, the HTML is not valid if we don't
            // add it, so insert it at the end.
            controller.enqueue(_encodedtags.ENCODED_TAGS.CLOSED.BODY_AND_HTML);
        }
    });
}
function createStripDocumentClosingTagsTransform() {
    return new TransformStream({
        transform (chunk, controller) {
            // We rely on the assumption that chunks will never break across a code unit.
            // This is reasonable because we currently concat all of React's output from a single
            // flush into one chunk before streaming it forward which means the chunk will represent
            // a single coherent utf-8 string. This is not safe to use if we change our streaming to no
            // longer do this large buffered chunk
            if ((0, _uint8arrayhelpers.isEquivalentUint8Arrays)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.BODY_AND_HTML) || (0, _uint8arrayhelpers.isEquivalentUint8Arrays)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.BODY) || (0, _uint8arrayhelpers.isEquivalentUint8Arrays)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.HTML)) {
                // the entire chunk is the closing tags; return without enqueueing anything.
                return;
            }
            // We assume these tags will go at together at the end of the document and that
            // they won't appear anywhere else in the document. This is not really a safe assumption
            // but until we revamp our streaming infra this is a performant way to string the tags
            chunk = (0, _uint8arrayhelpers.removeFromUint8Array)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.BODY);
            chunk = (0, _uint8arrayhelpers.removeFromUint8Array)(chunk, _encodedtags.ENCODED_TAGS.CLOSED.HTML);
            controller.enqueue(chunk);
        }
    });
}
function createHtmlDataDplIdTransformStream(dplId) {
    let didTransform = false;
    return new TransformStream({
        transform (chunk, controller) {
            if (didTransform) {
                controller.enqueue(chunk);
                return;
            }
            const htmlTagIndex = (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.OPENING.HTML);
            if (htmlTagIndex === -1) {
                controller.enqueue(chunk);
                return;
            }
            // Insert the data-dpl-id attribute right after "<html "
            const insertionPoint = htmlTagIndex + _encodedtags.ENCODED_TAGS.OPENING.HTML.length;
            const attribute = ` data-dpl-id="${dplId}"`;
            const encodedAttribute = encoder.encode(attribute);
            const modifiedChunk = new Uint8Array(chunk.length + encodedAttribute.length);
            // Copy everything before the insertion point
            modifiedChunk.set(chunk.subarray(0, insertionPoint));
            // Insert the attribute
            modifiedChunk.set(encodedAttribute, insertionPoint);
            // Copy everything after
            modifiedChunk.set(chunk.subarray(insertionPoint), insertionPoint + encodedAttribute.length);
            controller.enqueue(modifiedChunk);
            didTransform = true;
        }
    });
}
function createRootLayoutValidatorStream() {
    let foundHtml = false;
    let foundBody = false;
    return new TransformStream({
        async transform (chunk, controller) {
            // Peek into the streamed chunk to see if the tags are present.
            if (!foundHtml && (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.OPENING.HTML) > -1) {
                foundHtml = true;
            }
            if (!foundBody && (0, _uint8arrayhelpers.indexOfUint8Array)(chunk, _encodedtags.ENCODED_TAGS.OPENING.BODY) > -1) {
                foundBody = true;
            }
            controller.enqueue(chunk);
        },
        flush (controller) {
            const missingTags = [];
            if (!foundHtml) missingTags.push('html');
            if (!foundBody) missingTags.push('body');
            if (!missingTags.length) return;
            controller.enqueue(encoder.encode(`<html id="__next_error__">
            <template
              data-next-error-message="Missing ${missingTags.map((c)=>`<${c}>`).join(missingTags.length > 1 ? ' and ' : '')} tags in the root layout.\nRead more at https://nextjs.org/docs/messages/missing-root-layout-tags"
              data-next-error-digest="${_constants1.MISSING_ROOT_TAGS_ERROR}"
              data-next-error-stack=""
            ></template>
          `));
        }
    });
}
function chainTransformers(readable, transformers) {
    let stream = readable;
    for (const transformer of transformers){
        if (!transformer) continue;
        stream = stream.pipeThrough(transformer);
    }
    return stream;
}
async function continueFizzStream(renderStream, { suffix, inlinedDataStream, isStaticGeneration, deploymentId, getServerInsertedHTML, getServerInsertedMetadata, validateRootLayout }) {
    // Suffix itself might contain close tags at the end, so we need to split it.
    const suffixUnclosed = suffix ? suffix.split(CLOSE_TAG, 1)[0] : null;
    if (isStaticGeneration) {
        // If we're generating static HTML we need to wait for it to resolve before continuing.
        await renderStream.allReady;
    } else {
        // Otherwise, we want to make sure Fizz is done with all microtasky work
        // before we start pulling the stream and cause a flush.
        await (0, _scheduler.waitAtLeastOneReactRenderTask)();
    }
    return chainTransformers(renderStream, [
        // Buffer everything to avoid flushing too frequently
        createBufferedTransformStream(),
        // Insert data-dpl-id attribute on the html tag
        deploymentId ? createHtmlDataDplIdTransformStream(deploymentId) : null,
        // Transform metadata
        createMetadataTransformStream(getServerInsertedMetadata),
        // Insert suffix content
        suffixUnclosed != null && suffixUnclosed.length > 0 ? createDeferredSuffixStream(suffixUnclosed) : null,
        // Insert the inlined data (Flight data, form state, etc.) stream into the HTML
        inlinedDataStream ? createFlightDataInjectionTransformStream(inlinedDataStream, true) : null,
        // Validate the root layout for missing html or body tags
        validateRootLayout ? createRootLayoutValidatorStream() : null,
        // Close tags should always be deferred to the end
        createMoveSuffixStream(),
        // Special head insertions
        // TODO-APP: Insert server side html to end of head in app layout rendering, to avoid
        // hydration errors. Remove this once it's ready to be handled by react itself.
        createHeadInsertionTransformStream(getServerInsertedHTML)
    ]);
}
async function continueDynamicPrerender(prerenderStream, { getServerInsertedHTML, getServerInsertedMetadata, deploymentId }) {
    return chainTransformers(prerenderStream, [
        // Buffer everything to avoid flushing too frequently
        createBufferedTransformStream(),
        createStripDocumentClosingTagsTransform(),
        // Insert data-dpl-id attribute on the html tag
        deploymentId ? createHtmlDataDplIdTransformStream(deploymentId) : null,
        // Insert generated tags to head
        createHeadInsertionTransformStream(getServerInsertedHTML),
        // Transform metadata
        createMetadataTransformStream(getServerInsertedMetadata)
    ]);
}
async function continueStaticPrerender(prerenderStream, { inlinedDataStream, getServerInsertedHTML, getServerInsertedMetadata, deploymentId }) {
    return chainTransformers(prerenderStream, [
        // Buffer everything to avoid flushing too frequently
        createBufferedTransformStream(),
        // Add build id comment to start of the HTML document (in export mode)
        // Insert data-dpl-id attribute on the html tag
        deploymentId ? createHtmlDataDplIdTransformStream(deploymentId) : null,
        // Insert generated tags to head
        createHeadInsertionTransformStream(getServerInsertedHTML),
        // Transform metadata
        createMetadataTransformStream(getServerInsertedMetadata),
        // Insert the inlined data (Flight data, form state, etc.) stream into the HTML
        createFlightDataInjectionTransformStream(inlinedDataStream, true),
        // Close tags should always be deferred to the end
        createMoveSuffixStream()
    ]);
}
async function continueStaticFallbackPrerender(prerenderStream, { inlinedDataStream, getServerInsertedHTML, getServerInsertedMetadata, deploymentId }) {
    // Same as `continueStaticPrerender`, but also inserts an additional script
    // to instruct the client to start fetching the hydration data as early
    // as possible.
    return chainTransformers(prerenderStream, [
        // Buffer everything to avoid flushing too frequently
        createBufferedTransformStream(),
        // Insert data-dpl-id attribute on the html tag
        deploymentId ? createHtmlDataDplIdTransformStream(deploymentId) : null,
        // Insert generated tags to head
        createHeadInsertionTransformStream(getServerInsertedHTML),
        // Insert the client resume script into the head
        createClientResumeScriptInsertionTransformStream(),
        // Transform metadata
        createMetadataTransformStream(getServerInsertedMetadata),
        // Insert the inlined data (Flight data, form state, etc.) stream into the HTML
        createFlightDataInjectionTransformStream(inlinedDataStream, true),
        // Close tags should always be deferred to the end
        createMoveSuffixStream()
    ]);
}
async function continueDynamicHTMLResume(renderStream, { delayDataUntilFirstHtmlChunk, inlinedDataStream, getServerInsertedHTML, getServerInsertedMetadata, deploymentId }) {
    return chainTransformers(renderStream, [
        // Buffer everything to avoid flushing too frequently
        createBufferedTransformStream(),
        // Insert data-dpl-id attribute on the html tag
        deploymentId ? createHtmlDataDplIdTransformStream(deploymentId) : null,
        // Insert generated tags to head
        createHeadInsertionTransformStream(getServerInsertedHTML),
        // Transform metadata
        createMetadataTransformStream(getServerInsertedMetadata),
        // Insert the inlined data (Flight data, form state, etc.) stream into the HTML
        createFlightDataInjectionTransformStream(inlinedDataStream, delayDataUntilFirstHtmlChunk),
        // Close tags should always be deferred to the end
        createMoveSuffixStream()
    ]);
}
function createDocumentClosingStream() {
    return streamFromString(CLOSE_TAG);
}
function createRuntimePrefetchTransformStream(sentinel, isPartial, staleTime) {
    const enc = new TextEncoder();
    // Search for: [<sentinel>]
    // Replace with: [<isPartial>,<staleTime>]
    const search = enc.encode(`[${sentinel}]`);
    const first = search[0];
    const replace = enc.encode(`[${isPartial},${staleTime}]`);
    const searchLen = search.length;
    let currentChunk = null;
    let found = false;
    function processChunk(controller, nextChunk) {
        if (found) {
            if (nextChunk) {
                controller.enqueue(nextChunk);
            }
            return;
        }
        if (currentChunk) {
            // We can't search past the index that can contain a full match
            let exclusiveUpperBound = currentChunk.length - (searchLen - 1);
            if (nextChunk) {
                // If we have any overflow bytes we can search up to the chunk's final byte
                exclusiveUpperBound += Math.min(nextChunk.length, searchLen - 1);
            }
            if (exclusiveUpperBound < 1) {
                // we can't match the current chunk.
                controller.enqueue(currentChunk);
                currentChunk = nextChunk // advance so we don't process this chunk again
                ;
                return;
            }
            let currentIndex = currentChunk.indexOf(first);
            // check the current candidate match if it is within the bounds of our search space for the currentChunk
            candidateLoop: while(-1 < currentIndex && currentIndex < exclusiveUpperBound){
                // We already know index 0 matches because we used indexOf to find the candidateIndex so we start at index 1
                let matchIndex = 1;
                while(matchIndex < searchLen){
                    const candidateIndex = currentIndex + matchIndex;
                    const candidateValue = candidateIndex < currentChunk.length ? currentChunk[candidateIndex] : nextChunk[candidateIndex - currentChunk.length];
                    if (candidateValue !== search[matchIndex]) {
                        // No match, reset and continue the search from the next position
                        currentIndex = currentChunk.indexOf(first, currentIndex + 1);
                        continue candidateLoop;
                    }
                    matchIndex++;
                }
                // We found a complete match. currentIndex is our starting point to replace the value.
                found = true;
                // enqueue everything up to the match
                controller.enqueue(currentChunk.subarray(0, currentIndex));
                // enqueue the replacement value
                controller.enqueue(replace);
                // If there are bytes in the currentChunk after the match enqueue them
                if (currentIndex + searchLen < currentChunk.length) {
                    controller.enqueue(currentChunk.slice(currentIndex + searchLen));
                }
                // If we have a next chunk we enqueue it now
                if (nextChunk) {
                    // if replacement spills over to the next chunk we first exclude the replaced bytes
                    const overflowBytes = currentIndex + searchLen - currentChunk.length;
                    const truncatedChunk = overflowBytes > 0 ? nextChunk.subarray(overflowBytes) : nextChunk;
                    controller.enqueue(truncatedChunk);
                }
                // We are now in found mode and don't need to track currentChunk anymore
                currentChunk = null;
                return;
            }
            // No match found in this chunk, emit it and wait for the next one
            controller.enqueue(currentChunk);
        }
        // Advance to the next chunk
        currentChunk = nextChunk;
    }
    return new TransformStream({
        transform (chunk, controller) {
            processChunk(controller, chunk);
        },
        flush (controller) {
            processChunk(controller, null);
        }
    });
}

//# sourceMappingURL=node-web-streams-helper.js.map