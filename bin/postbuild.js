// Postbuild script for 9Router
// This script runs after the Next.js build to prepare the standalone server

const fs = require('fs');
const path = require('path');

console.log('Running postbuild tasks...');

// Ensure bin directory exists
const binDir = path.join(__dirname, '..');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// Make cli.js executable
const cliPath = path.join(__dirname, 'cli.js');
if (fs.existsSync(cliPath)) {
  fs.chmodSync(cliPath, '755');
  console.log('✓ Made cli.js executable');
}

console.log('✓ Postbuild tasks completed');
