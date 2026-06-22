// ESM re-export of the canonical CJS implementation.
// Next.js/webpack transpiles this; standalone CJS scripts require dataDir.cjs directly.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { getDataDir, DATA_DIR } = require("./dataDir.cjs");

export { getDataDir, DATA_DIR };
