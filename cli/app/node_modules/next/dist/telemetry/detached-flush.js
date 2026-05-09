"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _storage = require("./storage");
const _config = /*#__PURE__*/ _interop_require_default(require("../server/config"));
const _getprojectdir = require("../lib/get-project-dir");
const _constants = require("../shared/lib/constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
(async ()=>{
    const args = [
        ...process.argv
    ];
    const eventsFile = args.pop();
    let dir = args.pop();
    const mode = args.pop();
    if (!dir || mode !== 'dev') {
        throw Object.defineProperty(new Error(`Invalid flags should be run as node detached-flush dev ./path-to/project [eventsFile]`), "__NEXT_ERROR_CODE", {
            value: "E908",
            enumerable: false,
            configurable: true
        });
    }
    dir = (0, _getprojectdir.getProjectDir)(dir);
    const config = await (0, _config.default)(_constants.PHASE_DEVELOPMENT_SERVER, dir);
    const distDir = _path.default.join(dir, config.distDir || '.next');
    // Support both old format (no eventsFile arg) and new format (with eventsFile arg)
    const eventsPath = _path.default.join(distDir, eventsFile && !eventsFile.includes('/') ? eventsFile : '_events.json');
    let events;
    try {
        events = JSON.parse(_fs.default.readFileSync(eventsPath, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') {
            // no events to process we can exit now
            process.exit(0);
        }
        throw err;
    }
    const telemetry = new _storage.Telemetry({
        distDir
    });
    await telemetry.record(events);
    await telemetry.flush();
    // finished flushing events clean-up
    _fs.default.unlinkSync(eventsPath);
// Don't call process.exit() here - let Node.js exit naturally after
// all pending work completes (e.g., setTimeout in debug telemetry)
})();

//# sourceMappingURL=detached-flush.js.map