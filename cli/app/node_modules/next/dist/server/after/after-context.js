"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AfterContext", {
    enumerable: true,
    get: function() {
        return AfterContext;
    }
});
const _pqueue = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/p-queue"));
const _invarianterror = require("../../shared/lib/invariant-error");
const _isthenable = require("../../shared/lib/is-thenable");
const _workasyncstorageexternal = require("../app-render/work-async-storage.external");
const _revalidationutils = require("../revalidation-utils");
const _asynclocalstorage = require("../app-render/async-local-storage");
const _workunitasyncstorageexternal = require("../app-render/work-unit-async-storage.external");
const _aftertaskasyncstorageexternal = require("../app-render/after-task-async-storage.external");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class AfterContext {
    constructor({ waitUntil, onClose, onTaskError }){
        this.workUnitStores = new Set();
        this.waitUntil = waitUntil;
        this.onClose = onClose;
        this.onTaskError = onTaskError;
        this.callbackQueue = new _pqueue.default();
        this.callbackQueue.pause();
    }
    after(task) {
        if ((0, _isthenable.isThenable)(task)) {
            if (!this.waitUntil) {
                errorWaitUntilNotAvailable();
            }
            this.waitUntil(task.catch((error)=>this.reportTaskError('promise', error)));
        } else if (typeof task === 'function') {
            // TODO(after): implement tracing
            this.addCallback(task);
        } else {
            throw Object.defineProperty(new Error('`after()`: Argument must be a promise or a function'), "__NEXT_ERROR_CODE", {
                value: "E50",
                enumerable: false,
                configurable: true
            });
        }
    }
    addCallback(callback) {
        // if something is wrong, throw synchronously, bubbling up to the `after` callsite.
        if (!this.waitUntil) {
            errorWaitUntilNotAvailable();
        }
        const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
        if (workUnitStore) {
            this.workUnitStores.add(workUnitStore);
        }
        const afterTaskStore = _aftertaskasyncstorageexternal.afterTaskAsyncStorage.getStore();
        // This is used for checking if request APIs can be called inside `after`.
        // Note that we need to check the phase in which the *topmost* `after` was called (which should be "action"),
        // not the current phase (which might be "after" if we're in a nested after).
        // Otherwise, we might allow `after(() => headers())`, but not `after(() => after(() => headers()))`.
        const rootTaskSpawnPhase = afterTaskStore ? afterTaskStore.rootTaskSpawnPhase // nested after
         : workUnitStore == null ? void 0 : workUnitStore.phase // topmost after
        ;
        // this should only happen once.
        if (!this.runCallbacksOnClosePromise) {
            this.runCallbacksOnClosePromise = this.runCallbacksOnClose();
            this.waitUntil(this.runCallbacksOnClosePromise);
        }
        // Bind the callback to the current execution context (i.e. preserve all currently available ALS-es).
        // We do this because we want all of these to be equivalent in every regard except timing:
        //   after(() => x())
        //   after(x())
        //   await x()
        const wrappedCallback = (0, _asynclocalstorage.bindSnapshot)(// WARNING: Don't make this a named function. It must be anonymous.
        // See: https://github.com/facebook/react/pull/34911
        async ()=>{
            try {
                await _aftertaskasyncstorageexternal.afterTaskAsyncStorage.run({
                    rootTaskSpawnPhase
                }, ()=>callback());
            } catch (error) {
                this.reportTaskError('function', error);
            }
        });
        this.callbackQueue.add(wrappedCallback);
    }
    async runCallbacksOnClose() {
        await new Promise((resolve)=>this.onClose(resolve));
        return this.runCallbacks();
    }
    async runCallbacks() {
        if (this.callbackQueue.size === 0) return;
        for (const workUnitStore of this.workUnitStores){
            workUnitStore.phase = 'after';
        }
        const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
        if (!workStore) {
            throw Object.defineProperty(new _invarianterror.InvariantError('Missing workStore in AfterContext.runCallbacks'), "__NEXT_ERROR_CODE", {
                value: "E547",
                enumerable: false,
                configurable: true
            });
        }
        return (0, _revalidationutils.withExecuteRevalidates)(workStore, ()=>{
            this.callbackQueue.start();
            return this.callbackQueue.onIdle();
        });
    }
    reportTaskError(taskKind, error) {
        // TODO(after): this is fine for now, but will need better intergration with our error reporting.
        // TODO(after): should we log this if we have a onTaskError callback?
        console.error(taskKind === 'promise' ? `A promise passed to \`after()\` rejected:` : `An error occurred in a function passed to \`after()\`:`, error);
        if (this.onTaskError) {
            // this is very defensive, but we really don't want anything to blow up in an error handler
            try {
                this.onTaskError == null ? void 0 : this.onTaskError.call(this, error);
            } catch (handlerError) {
                console.error(Object.defineProperty(new _invarianterror.InvariantError('`onTaskError` threw while handling an error thrown from an `after` task', {
                    cause: handlerError
                }), "__NEXT_ERROR_CODE", {
                    value: "E569",
                    enumerable: false,
                    configurable: true
                }));
            }
        }
    }
}
function errorWaitUntilNotAvailable() {
    throw Object.defineProperty(new Error('`after()` will not work correctly, because `waitUntil` is not available in the current environment.'), "__NEXT_ERROR_CODE", {
        value: "E91",
        enumerable: false,
        configurable: true
    });
}

//# sourceMappingURL=after-context.js.map