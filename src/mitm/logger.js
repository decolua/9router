function time() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const log = (msg) => console.log(`[${time()}] [MITM] ${msg}`);
const err = (msg) => console.error(`[${time()}] ❌ [MITM] ${msg}`);

module.exports = { log, err };
