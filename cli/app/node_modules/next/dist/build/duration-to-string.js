// Time thresholds in seconds
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    durationToString: null,
    hrtimeBigIntDurationToString: null,
    hrtimeDurationToString: null,
    hrtimeToSeconds: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    durationToString: function() {
        return durationToString;
    },
    hrtimeBigIntDurationToString: function() {
        return hrtimeBigIntDurationToString;
    },
    hrtimeDurationToString: function() {
        return hrtimeDurationToString;
    },
    hrtimeToSeconds: function() {
        return hrtimeToSeconds;
    }
});
const SECONDS_IN_MINUTE = 60;
const MINUTES_THRESHOLD_SECONDS = 120 // 2 minutes
;
const SECONDS_THRESHOLD_HIGH = 40;
const SECONDS_THRESHOLD_LOW = 2;
const MILLISECONDS_PER_SECOND = 1000;
// Time thresholds and conversion factors for nanoseconds
const NANOSECONDS_PER_SECOND = 1000000000;
const NANOSECONDS_PER_MILLISECOND = 1000000;
const NANOSECONDS_PER_MICROSECOND = 1000;
const NANOSECONDS_IN_MINUTE = 60000000000 // 60 * 1_000_000_000
;
const MINUTES_THRESHOLD_NANOSECONDS = 120000000000 // 2 minutes in nanoseconds
;
const SECONDS_THRESHOLD_HIGH_NANOSECONDS = 40000000000 // 40 seconds in nanoseconds
;
const SECONDS_THRESHOLD_LOW_NANOSECONDS = 2000000000 // 2 seconds in nanoseconds
;
const MILLISECONDS_THRESHOLD_NANOSECONDS = 2000000 // 2 milliseconds in nanoseconds
;
function durationToString(compilerDuration) {
    if (compilerDuration > MINUTES_THRESHOLD_SECONDS) {
        return `${(compilerDuration / SECONDS_IN_MINUTE).toFixed(1)}min`;
    } else if (compilerDuration > SECONDS_THRESHOLD_HIGH) {
        return `${compilerDuration.toFixed(0)}s`;
    } else if (compilerDuration > SECONDS_THRESHOLD_LOW) {
        return `${compilerDuration.toFixed(1)}s`;
    } else {
        return `${(compilerDuration * MILLISECONDS_PER_SECOND).toFixed(0)}ms`;
    }
}
/**
 * Converts a nanosecond duration to a human-readable string format.
 * Formats duration based on magnitude for optimal readability:
 * - >= 2 minutes: show in minutes with 1 decimal place (e.g., "2.5min")
 * - >= 40 seconds: show in whole seconds (e.g., "45s")
 * - >= 2 seconds: show in seconds with 1 decimal place (e.g., "3.2s")
 * - >= 2 milliseconds: show in whole milliseconds (e.g., "250ms")
 * - < 2 milliseconds: show in whole microseconds (e.g., "500µs")
 *
 * @param durationBigInt - Duration in nanoseconds as a BigInt
 * @returns Formatted duration string with appropriate unit and precision
 */ function durationToStringWithNanoseconds(durationBigInt) {
    const duration = Number(durationBigInt);
    if (duration >= MINUTES_THRESHOLD_NANOSECONDS) {
        return `${(duration / NANOSECONDS_IN_MINUTE).toFixed(1)}min`;
    } else if (duration >= SECONDS_THRESHOLD_HIGH_NANOSECONDS) {
        return `${(duration / NANOSECONDS_PER_SECOND).toFixed(0)}s`;
    } else if (duration >= SECONDS_THRESHOLD_LOW_NANOSECONDS) {
        return `${(duration / NANOSECONDS_PER_SECOND).toFixed(1)}s`;
    } else if (duration >= MILLISECONDS_THRESHOLD_NANOSECONDS) {
        return `${(duration / NANOSECONDS_PER_MILLISECOND).toFixed(0)}ms`;
    } else {
        return `${(duration / NANOSECONDS_PER_MICROSECOND).toFixed(0)}µs`;
    }
}
function hrtimeToSeconds(hrtime) {
    // hrtime is a tuple of [seconds, nanoseconds]
    return hrtime[0] + hrtime[1] / NANOSECONDS_PER_SECOND;
}
function hrtimeBigIntDurationToString(hrtime) {
    return durationToStringWithNanoseconds(hrtime);
}
function hrtimeDurationToString(hrtime) {
    return durationToString(hrtimeToSeconds(hrtime));
}

//# sourceMappingURL=duration-to-string.js.map