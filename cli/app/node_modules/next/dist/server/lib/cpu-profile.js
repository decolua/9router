"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "saveCpuProfile", {
    enumerable: true,
    get: function() {
        return saveCpuProfile;
    }
});
const privateCpuProfileName = process.env.__NEXT_PRIVATE_CPU_PROFILE;
const isCpuProfileEnabled = process.env.NEXT_CPU_PROF || privateCpuProfileName;
const cpuProfileDir = process.env.NEXT_CPU_PROF_DIR;
let session = null;
let profileSaved = false;
if (isCpuProfileEnabled) {
    const { Session } = require('inspector');
    session = new Session();
    session.connect();
    session.post('Profiler.enable');
    session.post('Profiler.start');
    process.on('exit', ()=>{
        saveCpuProfile();
    });
}
function saveCpuProfile() {
    if (!session || profileSaved || !isCpuProfileEnabled) {
        return;
    }
    profileSaved = true;
    const fs = require('fs');
    const path = require('path');
    session.post('Profiler.stop', (error, param)=>{
        if (error) {
            console.error('Cannot generate CPU profiling:', error);
            return;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const baseName = privateCpuProfileName || 'cpu-profile';
        const filename = `${baseName}-${timestamp}.cpuprofile`;
        let outputPath;
        if (cpuProfileDir) {
            if (!fs.existsSync(cpuProfileDir)) {
                fs.mkdirSync(cpuProfileDir, {
                    recursive: true
                });
            }
            outputPath = path.join(cpuProfileDir, filename);
        } else {
            outputPath = `./${filename}`;
        }
        fs.writeFileSync(outputPath, JSON.stringify(param.profile));
        const { green } = require('../../lib/picocolors');
        console.log(`\n${green('CPU profile saved:')} ${outputPath}`);
        console.log('Open in Chrome DevTools → Performance tab → Load profile');
    });
}

//# sourceMappingURL=cpu-profile.js.map