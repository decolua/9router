"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "runLoaderWorkerPool", {
    enumerable: true,
    get: function() {
        return runLoaderWorkerPool;
    }
});
const _worker_threads = require("worker_threads");
const loaderWorkers = {};
function getPoolId(cwd, filename) {
    return `${cwd}:${filename}`;
}
async function runLoaderWorkerPool(bindings, bindingPath) {
    bindings.registerWorkerScheduler((creation)=>{
        const { options: { filename, cwd } } = creation;
        const poolId = getPoolId(cwd, filename);
        const worker = new _worker_threads.Worker(/* turbopackIgnore: true*/ filename, {
            workerData: {
                bindingPath,
                cwd
            }
        });
        // This will cause handing when run in jest worker, but not as a first level thread of nodejs thread
        // worker.unref()
        const workers = loaderWorkers[poolId] || (loaderWorkers[poolId] = new Map());
        workers.set(worker.threadId, worker);
    }, (termination)=>{
        var _workers_get;
        const { options: { filename, cwd }, workerId } = termination;
        const poolId = getPoolId(cwd, filename);
        const workers = loaderWorkers[poolId];
        (_workers_get = workers.get(workerId)) == null ? void 0 : _workers_get.terminate();
        workers.delete(workerId);
    });
}

//# sourceMappingURL=loaderWorkerPool.js.map