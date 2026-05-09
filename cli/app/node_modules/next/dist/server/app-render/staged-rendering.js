"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    RenderStage: null,
    StagedRenderingController: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    RenderStage: function() {
        return RenderStage;
    },
    StagedRenderingController: function() {
        return StagedRenderingController;
    }
});
const _invarianterror = require("../../shared/lib/invariant-error");
const _promisewithresolvers = require("../../shared/lib/promise-with-resolvers");
var RenderStage = /*#__PURE__*/ function(RenderStage) {
    RenderStage[RenderStage["Before"] = 1] = "Before";
    RenderStage[RenderStage["EarlyStatic"] = 2] = "EarlyStatic";
    RenderStage[RenderStage["Static"] = 3] = "Static";
    RenderStage[RenderStage["EarlyRuntime"] = 4] = "EarlyRuntime";
    RenderStage[RenderStage["Runtime"] = 5] = "Runtime";
    RenderStage[RenderStage["Dynamic"] = 6] = "Dynamic";
    RenderStage[RenderStage["Abandoned"] = 7] = "Abandoned";
    return RenderStage;
}({});
class StagedRenderingController {
    constructor(abortSignal, abandonController, shouldTrackSyncIO){
        this.abortSignal = abortSignal;
        this.abandonController = abandonController;
        this.shouldTrackSyncIO = shouldTrackSyncIO;
        this.currentStage = 1;
        this.syncInterruptReason = null;
        this.staticStageEndTime = Infinity;
        this.runtimeStageEndTime = Infinity;
        this.staticStageListeners = [];
        this.earlyRuntimeStageListeners = [];
        this.runtimeStageListeners = [];
        this.dynamicStageListeners = [];
        this.staticStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        this.earlyRuntimeStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        this.runtimeStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        this.dynamicStagePromise = (0, _promisewithresolvers.createPromiseWithResolvers)();
        if (abortSignal) {
            abortSignal.addEventListener('abort', ()=>{
                // Reject all stage promises that haven't already been resolved.
                // If a promise was already resolved via advanceStage, the reject
                // is a no-op. The ignoreReject handler suppresses unhandled
                // rejection warnings for promises that no one is awaiting.
                const { reason } = abortSignal;
                this.staticStagePromise.promise.catch(ignoreReject);
                this.staticStagePromise.reject(reason);
                this.earlyRuntimeStagePromise.promise.catch(ignoreReject);
                this.earlyRuntimeStagePromise.reject(reason);
                this.runtimeStagePromise.promise.catch(ignoreReject);
                this.runtimeStagePromise.reject(reason);
                this.dynamicStagePromise.promise.catch(ignoreReject);
                this.dynamicStagePromise.reject(reason);
            }, {
                once: true
            });
        }
        if (abandonController) {
            abandonController.signal.addEventListener('abort', ()=>{
                this.abandonRender();
            }, {
                once: true
            });
        }
    }
    onStage(stage, callback) {
        if (this.currentStage >= stage) {
            callback();
        } else if (stage === 3) {
            this.staticStageListeners.push(callback);
        } else if (stage === 4) {
            this.earlyRuntimeStageListeners.push(callback);
        } else if (stage === 5) {
            this.runtimeStageListeners.push(callback);
        } else if (stage === 6) {
            this.dynamicStageListeners.push(callback);
        } else {
            // This should never happen
            throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid render stage: ${stage}`), "__NEXT_ERROR_CODE", {
                value: "E881",
                enumerable: false,
                configurable: true
            });
        }
    }
    shouldTrackSyncInterrupt() {
        if (!this.shouldTrackSyncIO) {
            return false;
        }
        switch(this.currentStage){
            case 1:
                // If we haven't started the render yet, it can't be interrupted.
                return false;
            case 2:
            case 3:
                return true;
            case 4:
                // EarlyRuntime is for runtime-prefetchable segments. Sync IO
                // should error because it would abort a runtime prefetch.
                return true;
            case 5:
                // Runtime is for non-prefetchable segments. Sync IO is fine there
                // because in practice this segment will never be runtime prefetched
                return false;
            case 6:
            case 7:
                return false;
            default:
                return false;
        }
    }
    syncInterruptCurrentStageWithReason(reason) {
        if (this.currentStage === 1) {
            return;
        }
        // If the render has already been abandoned, there's nothing to interrupt.
        if (this.currentStage === 7) {
            return;
        }
        // If Sync IO occurs during an abandonable render, we trigger the abandon.
        // The abandon listener will call abandonRender which advances through
        // stages to let caches fill before marking as Abandoned.
        if (this.abandonController) {
            this.abandonController.abort();
            return;
        }
        if (this.abortSignal) {
            // If this is an abortable render, we capture the interruption reason and stop advancing.
            // We don't release any more promises.
            // The caller is expected to abort the signal.
            this.syncInterruptReason = reason;
            this.currentStage = 7;
            return;
        }
        // If we're in a non-abandonable & non-abortable render,
        // we need to advance to the Dynamic stage and capture the interruption reason.
        // (in dev, this will be the restarted render)
        switch(this.currentStage){
            case 2:
            case 3:
            case 4:
                {
                    // EarlyRuntime is for runtime-prefetchable segments. Sync IO here
                    // means the prefetch would be aborted too early.
                    this.syncInterruptReason = reason;
                    this.advanceStage(6);
                    return;
                }
            case 5:
                {
                    // canSyncInterrupt returns false for Runtime, so we should
                    // never get here. Defensive no-op.
                    return;
                }
            case 6:
            default:
        }
    }
    getSyncInterruptReason() {
        return this.syncInterruptReason;
    }
    getStaticStageEndTime() {
        return this.staticStageEndTime;
    }
    getRuntimeStageEndTime() {
        return this.runtimeStageEndTime;
    }
    abandonRender() {
        // In staged rendering, only the initial render is abandonable.
        // We can abandon the initial render if
        //   1. We notice a cache miss, and need to wait for caches to fill
        //   2. A sync IO error occurs, and the render should be interrupted
        //      (this might be a lazy intitialization of a module,
        //       so we still want to restart in this case and see if it still occurs)
        // In either case, we'll be doing another render after this one,
        // so we only want to unblock the next stage, not Dynamic, because
        // unblocking the dynamic stage would likely lead to wasted (uncached) IO.
        const { currentStage } = this;
        switch(currentStage){
            case 2:
                {
                    this.resolveStaticStage();
                }
            // intentional fallthrough
            case 3:
                {
                    this.resolveEarlyRuntimeStage();
                }
            // intentional fallthrough
            case 4:
                {
                    this.resolveRuntimeStage();
                }
            // intentional fallthrough
            case 5:
                {
                    this.currentStage = 7;
                    return;
                }
            case 6:
            case 1:
            case 7:
                break;
            default:
                {
                    currentStage;
                }
        }
    }
    advanceStage(stage) {
        // If we're already at the target stage or beyond, do nothing.
        // (this can happen e.g. if sync IO advanced us to the dynamic stage)
        if (stage <= this.currentStage) {
            return;
        }
        let currentStage = this.currentStage;
        this.currentStage = stage;
        if (currentStage < 3 && stage >= 3) {
            this.resolveStaticStage();
        }
        if (currentStage < 4 && stage >= 4) {
            this.resolveEarlyRuntimeStage();
        }
        if (currentStage < 5 && stage >= 5) {
            this.staticStageEndTime = performance.now() + performance.timeOrigin;
            this.resolveRuntimeStage();
        }
        if (currentStage < 6 && stage >= 6) {
            this.runtimeStageEndTime = performance.now() + performance.timeOrigin;
            this.resolveDynamicStage();
            return;
        }
    }
    /** Fire the `onStage` listeners for the static stage and unblock any promises waiting for it. */ resolveStaticStage() {
        const staticListeners = this.staticStageListeners;
        for(let i = 0; i < staticListeners.length; i++){
            staticListeners[i]();
        }
        staticListeners.length = 0;
        this.staticStagePromise.resolve();
    }
    /** Fire the `onStage` listeners for the early runtime stage and unblock any promises waiting for it. */ resolveEarlyRuntimeStage() {
        const earlyRuntimeListeners = this.earlyRuntimeStageListeners;
        for(let i = 0; i < earlyRuntimeListeners.length; i++){
            earlyRuntimeListeners[i]();
        }
        earlyRuntimeListeners.length = 0;
        this.earlyRuntimeStagePromise.resolve();
    }
    /** Fire the `onStage` listeners for the runtime stage and unblock any promises waiting for it. */ resolveRuntimeStage() {
        const runtimeListeners = this.runtimeStageListeners;
        for(let i = 0; i < runtimeListeners.length; i++){
            runtimeListeners[i]();
        }
        runtimeListeners.length = 0;
        this.runtimeStagePromise.resolve();
    }
    /** Fire the `onStage` listeners for the dynamic stage and unblock any promises waiting for it. */ resolveDynamicStage() {
        const dynamicListeners = this.dynamicStageListeners;
        for(let i = 0; i < dynamicListeners.length; i++){
            dynamicListeners[i]();
        }
        dynamicListeners.length = 0;
        this.dynamicStagePromise.resolve();
    }
    getStagePromise(stage) {
        switch(stage){
            case 3:
                {
                    return this.staticStagePromise.promise;
                }
            case 4:
                {
                    return this.earlyRuntimeStagePromise.promise;
                }
            case 5:
                {
                    return this.runtimeStagePromise.promise;
                }
            case 6:
                {
                    return this.dynamicStagePromise.promise;
                }
            default:
                {
                    stage;
                    throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid render stage: ${stage}`), "__NEXT_ERROR_CODE", {
                        value: "E881",
                        enumerable: false,
                        configurable: true
                    });
                }
        }
    }
    waitForStage(stage) {
        return this.getStagePromise(stage);
    }
    delayUntilStage(stage, displayName, resolvedValue) {
        const ioTriggerPromise = this.getStagePromise(stage);
        const promise = makeDevtoolsIOPromiseFromIOTrigger(ioTriggerPromise, displayName, resolvedValue);
        // Analogously to `makeHangingPromise`, we might reject this promise if the signal is invoked.
        // (e.g. in the case where we don't want want the render to proceed to the dynamic stage and abort it).
        // We shouldn't consider this an unhandled rejection, so we attach a noop catch handler here to suppress this warning.
        if (this.abortSignal) {
            promise.catch(ignoreReject);
        }
        return promise;
    }
}
function ignoreReject() {}
// TODO(restart-on-cache-miss): the layering of `delayUntilStage`,
// `makeDevtoolsIOPromiseFromIOTrigger` and and `makeDevtoolsIOAwarePromise`
// is confusing, we should clean it up.
function makeDevtoolsIOPromiseFromIOTrigger(ioTrigger, displayName, resolvedValue) {
    // If we create a `new Promise` and give it a displayName
    // (with no userspace code above us in the stack)
    // React Devtools will use it as the IO cause when determining "suspended by".
    // In particular, it should shadow any inner IO that resolved/rejected the promise
    // (in case of staged rendering, this will be the `setTimeout` that triggers the relevant stage)
    const promise = new Promise((resolve, reject)=>{
        ioTrigger.then(resolve.bind(null, resolvedValue), reject);
    });
    if (displayName !== undefined) {
        // @ts-expect-error
        promise.displayName = displayName;
    }
    return promise;
}

//# sourceMappingURL=staged-rendering.js.map