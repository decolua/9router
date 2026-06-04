"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "io", {
    enumerable: true,
    get: function() {
        return io;
    }
});
const _workasyncstorageexternal = require("../app-render/work-async-storage.external");
const _workunitasyncstorageexternal = require("../app-render/work-unit-async-storage.external");
const _dynamicrendering = require("../app-render/dynamic-rendering");
const _invarianterror = require("../../shared/lib/invariant-error");
const _stagedrendering = require("../app-render/staged-rendering");
const _runtimereactsexternal = require("../runtime-reacts.external");
function io(expression, type) {
    const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
    if (!workUnitStore || !workStore) {
        return;
    }
    switch(workUnitStore.type){
        case 'prerender':
        case 'prerender-runtime':
            {
                const prerenderSignal = workUnitStore.controller.signal;
                if (prerenderSignal.aborted === false) {
                    // If the prerender signal is already aborted we don't need to construct
                    // any stacks because something else actually terminated the prerender.
                    let message;
                    switch(type){
                        case 'time':
                            message = `Route "${workStore.route}" used ${expression} before accessing either uncached data (e.g. \`fetch()\`) or Request data (e.g. \`cookies()\`, \`headers()\`, \`connection()\`, and \`searchParams\`). Accessing the current time in a Server Component requires reading one of these data sources first. Alternatively, consider moving this expression into a Client Component or Cache Component. See more info here: https://nextjs.org/docs/messages/next-prerender-current-time`;
                            break;
                        case 'random':
                            message = `Route "${workStore.route}" used ${expression} before accessing either uncached data (e.g. \`fetch()\`) or Request data (e.g. \`cookies()\`, \`headers()\`, \`connection()\`, and \`searchParams\`). Accessing random values synchronously in a Server Component requires reading one of these data sources first. Alternatively, consider moving this expression into a Client Component or Cache Component. See more info here: https://nextjs.org/docs/messages/next-prerender-random`;
                            break;
                        case 'crypto':
                            message = `Route "${workStore.route}" used ${expression} before accessing either uncached data (e.g. \`fetch()\`) or Request data (e.g. \`cookies()\`, \`headers()\`, \`connection()\`, and \`searchParams\`). Accessing random cryptographic values synchronously in a Server Component requires reading one of these data sources first. Alternatively, consider moving this expression into a Client Component or Cache Component. See more info here: https://nextjs.org/docs/messages/next-prerender-crypto`;
                            break;
                        default:
                            throw Object.defineProperty(new _invarianterror.InvariantError('Unknown expression type in abortOnSynchronousPlatformIOAccess.'), "__NEXT_ERROR_CODE", {
                                value: "E526",
                                enumerable: false,
                                configurable: true
                            });
                    }
                    (0, _dynamicrendering.abortOnSynchronousPlatformIOAccess)(workStore.route, expression, applyOwnerStack(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                        value: "E394",
                        enumerable: false,
                        configurable: true
                    })), workUnitStore);
                }
                break;
            }
        case 'prerender-client':
            {
                const prerenderSignal = workUnitStore.controller.signal;
                if (prerenderSignal.aborted === false) {
                    // If the prerender signal is already aborted we don't need to construct
                    // any stacks because something else actually terminated the prerender.
                    let message;
                    switch(type){
                        case 'time':
                            message = `Route "${workStore.route}" used ${expression} inside a Client Component without a Suspense boundary above it. See more info here: https://nextjs.org/docs/messages/next-prerender-current-time-client`;
                            break;
                        case 'random':
                            message = `Route "${workStore.route}" used ${expression} inside a Client Component without a Suspense boundary above it. See more info here: https://nextjs.org/docs/messages/next-prerender-random-client`;
                            break;
                        case 'crypto':
                            message = `Route "${workStore.route}" used ${expression} inside a Client Component without a Suspense boundary above it. See more info here: https://nextjs.org/docs/messages/next-prerender-crypto-client`;
                            break;
                        default:
                            throw Object.defineProperty(new _invarianterror.InvariantError('Unknown expression type in abortOnSynchronousPlatformIOAccess.'), "__NEXT_ERROR_CODE", {
                                value: "E526",
                                enumerable: false,
                                configurable: true
                            });
                    }
                    (0, _dynamicrendering.abortOnSynchronousPlatformIOAccess)(workStore.route, expression, applyOwnerStack(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                        value: "E394",
                        enumerable: false,
                        configurable: true
                    })), workUnitStore);
                }
                break;
            }
        case 'request':
            {
                const stageController = workUnitStore.stagedRendering;
                if (stageController && stageController.shouldTrackSyncInterrupt()) {
                    let message;
                    if (stageController.currentStage === _stagedrendering.RenderStage.Static || stageController.currentStage === _stagedrendering.RenderStage.EarlyStatic) {
                        switch(type){
                            case 'time':
                                message = `Route "${workStore.route}" used ${expression} before accessing either uncached data (e.g. \`fetch()\`) or Request data (e.g. \`cookies()\`, \`headers()\`, \`connection()\`, and \`searchParams\`). Accessing the current time in a Server Component requires reading one of these data sources first. Alternatively, consider moving this expression into a Client Component or Cache Component. See more info here: https://nextjs.org/docs/messages/next-prerender-current-time`;
                                break;
                            case 'random':
                                message = `Route "${workStore.route}" used ${expression} before accessing either uncached data (e.g. \`fetch()\`) or Request data (e.g. \`cookies()\`, \`headers()\`, \`connection()\`, and \`searchParams\`). Accessing random values synchronously in a Server Component requires reading one of these data sources first. Alternatively, consider moving this expression into a Client Component or Cache Component. See more info here: https://nextjs.org/docs/messages/next-prerender-random`;
                                break;
                            case 'crypto':
                                message = `Route "${workStore.route}" used ${expression} before accessing either uncached data (e.g. \`fetch()\`) or Request data (e.g. \`cookies()\`, \`headers()\`, \`connection()\`, and \`searchParams\`). Accessing random cryptographic values synchronously in a Server Component requires reading one of these data sources first. Alternatively, consider moving this expression into a Client Component or Cache Component. See more info here: https://nextjs.org/docs/messages/next-prerender-crypto`;
                                break;
                            default:
                                throw Object.defineProperty(new _invarianterror.InvariantError('Unknown expression type in abortOnSynchronousPlatformIOAccess.'), "__NEXT_ERROR_CODE", {
                                    value: "E526",
                                    enumerable: false,
                                    configurable: true
                                });
                        }
                    } else {
                        // We're in the Runtime stage.
                        // We only error for Sync IO in the Runtime stage if the route has a runtime prefetch config.
                        // This check is implemented in `stageController.canSyncInterrupt()` --
                        // if runtime prefetching isn't enabled, then we won't get here.
                        let accessStatement;
                        let additionalInfoLink;
                        switch(type){
                            case 'time':
                                accessStatement = 'the current time';
                                additionalInfoLink = 'https://nextjs.org/docs/messages/next-prerender-runtime-current-time';
                                break;
                            case 'random':
                                accessStatement = 'random values synchronously';
                                additionalInfoLink = 'https://nextjs.org/docs/messages/next-prerender-runtime-random';
                                break;
                            case 'crypto':
                                accessStatement = 'random cryptographic values synchronously';
                                additionalInfoLink = 'https://nextjs.org/docs/messages/next-prerender-runtime-crypto';
                                break;
                            default:
                                throw Object.defineProperty(new _invarianterror.InvariantError('Unknown expression type in abortOnSynchronousPlatformIOAccess.'), "__NEXT_ERROR_CODE", {
                                    value: "E526",
                                    enumerable: false,
                                    configurable: true
                                });
                        }
                        message = `Route "${workStore.route}" used ${expression} before accessing either uncached data (e.g. \`fetch()\`) or awaiting \`connection()\`. When configured for Runtime prefetching, accessing ${accessStatement} in a Server Component requires reading one of these data sources first. Alternatively, consider moving this expression into a Client Component or Cache Component. See more info here: ${additionalInfoLink}`;
                    }
                    const syncIOError = applyOwnerStack(Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                        value: "E394",
                        enumerable: false,
                        configurable: true
                    }));
                    stageController.syncInterruptCurrentStageWithReason(syncIOError);
                    // A build-time validation render uses a 'request' store type, but may be abortable.
                    // If we're in the second, restarted render of the restart-on-cache miss flow,
                    // Sync IO is an error, and unlike dev, there's no need to continue the render past the sync IO,
                    // so we can abort it.
                    if (workUnitStore.controller && !workUnitStore.controller.signal.aborted) {
                        workUnitStore.controller.abort(syncIOError);
                    }
                }
                break;
            }
        case 'validation-client':
        case 'prerender-ppr':
        case 'prerender-legacy':
        case 'cache':
        case 'private-cache':
        case 'unstable-cache':
        case 'generate-static-params':
            break;
        default:
            workUnitStore;
    }
}
function applyOwnerStack(error) {
    // TODO: Instead of stitching the stacks here, we should log the original
    // error as-is when it occurs, and let `patchErrorInspect` handle adding the
    // owner stack, instead of logging it deferred in the `LogSafely` component
    // via `throwIfDisallowedDynamic`.
    if (process.env.NODE_ENV !== 'production') {
        var _getClientReact_captureOwnerStack, _getClientReact, _getServerReact_captureOwnerStack, _getServerReact;
        const ownerStack = ((_getClientReact = (0, _runtimereactsexternal.getClientReact)()) == null ? void 0 : (_getClientReact_captureOwnerStack = _getClientReact.captureOwnerStack) == null ? void 0 : _getClientReact_captureOwnerStack.call(_getClientReact)) ?? ((_getServerReact = (0, _runtimereactsexternal.getServerReact)()) == null ? void 0 : (_getServerReact_captureOwnerStack = _getServerReact.captureOwnerStack) == null ? void 0 : _getServerReact_captureOwnerStack.call(_getServerReact));
        if (ownerStack) {
            let stack = ownerStack;
            if (error.stack) {
                const frames = [];
                for (const frame of error.stack.split('\n').slice(1)){
                    if (frame.includes('react_stack_bottom_frame')) {
                        break;
                    }
                    frames.push(frame);
                }
                stack = '\n' + frames.join('\n') + stack;
            }
            error.stack = error.name + ': ' + error.message + stack;
        }
    }
    return error;
}

//# sourceMappingURL=io-utils.js.map