// Force synchronous stdout/stderr writes in Docker (non-TTY pipe mode buffers
// output until the internal buffer fills, causing logs to appear in delayed batches).
if (process.stdout._handle) process.stdout._handle.setBlocking(true);
if (process.stderr._handle) process.stderr._handle.setBlocking(true);

require("./server.js");
