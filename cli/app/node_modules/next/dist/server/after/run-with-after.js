"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AfterRunner", {
    enumerable: true,
    get: function() {
        return AfterRunner;
    }
});
const _detachedpromise = require("../../lib/detached-promise");
const _webonclose = require("../web/web-on-close");
const _awaiter = require("./awaiter");
class AfterRunner {
    async executeAfter() {
        this.closeController.dispatchClose();
        await this.awaiter.awaiting();
        // if we got an error while running the callbacks,
        // thenthis is a noop, because the promise is already rejected
        this.finishedWithoutErrors.resolve();
        return this.finishedWithoutErrors.promise;
    }
    constructor(){
        this.awaiter = new _awaiter.AwaiterOnce();
        this.closeController = new _webonclose.CloseController();
        this.finishedWithoutErrors = new _detachedpromise.DetachedPromise();
        this.context = {
            waitUntil: this.awaiter.waitUntil.bind(this.awaiter),
            onClose: this.closeController.onClose.bind(this.closeController),
            onTaskError: (error)=>this.finishedWithoutErrors.reject(error)
        };
    }
}

//# sourceMappingURL=run-with-after.js.map