"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "MultiFileWriter", {
    enumerable: true,
    get: function() {
        return MultiFileWriter;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("../shared/lib/isomorphic/path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class MultiFileWriter {
    constructor(/**
     * The file system methods to use.
     */ fs){
        this.fs = fs;
        this.tasks = [];
    }
    /**
   * Finds or creates a task for a directory.
   *
   * @param directory - The directory to find or create a task for.
   * @returns The task for the directory.
   */ findOrCreateTask(directory) {
        // See if this directory already has a task to create it.
        for (const task of this.tasks){
            if (task[0] === directory) {
                return task;
            }
        }
        const promise = this.fs.mkdir(directory);
        // Attach a catch handler so that it doesn't throw an unhandled promise
        // rejection warning.
        promise.catch(()=>{});
        // Otherwise, create a new task for this directory.
        const task = [
            directory,
            promise,
            []
        ];
        this.tasks.push(task);
        return task;
    }
    /**
   * Appends a file to the writer to be written after its containing directory
   * is created. The file writer should be awaited after all the files have been
   * appended. Any async operation that occurs between appending and awaiting
   * may cause an unhandled promise rejection warning and potentially crash the
   * process.
   *
   * @param filePath - The path to the file to write.
   * @param data - The data to write to the file.
   */ append(filePath, data) {
        // Find or create a task for the directory that contains the file.
        const task = this.findOrCreateTask(_path.default.dirname(filePath));
        const promise = task[1].then(()=>this.fs.writeFile(filePath, data));
        // Attach a catch handler so that it doesn't throw an unhandled promise
        // rejection warning.
        promise.catch(()=>{});
        // Add the file write to the task AFTER the directory promise has resolved.
        task[2].push(promise);
    }
    /**
   * Returns a promise that resolves when all the files have been written.
   */ wait() {
        return Promise.all(this.tasks.flatMap((task)=>task[2]));
    }
}

//# sourceMappingURL=multi-file-writer.js.map