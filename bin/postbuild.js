// Postbuild script for 9Router
// This script runs after the Next.js build to prepare the standalone server

const fs = require('fs');
const path = require('path');

console.log('Running postbuild tasks...');

const projectRoot = path.join(__dirname, '..');
const standaloneDir = path.join(projectRoot, '.next', 'standalone');
const standaloneNextDir = path.join(standaloneDir, '.next');

// Ensure standalone .next directory exists
if (!fs.existsSync(standaloneNextDir)) {
  fs.mkdirSync(standaloneNextDir, { recursive: true });
}

// Copy .next/static so client assets are available in standalone mode
const staticSrc = path.join(projectRoot, '.next', 'static');
const staticDest = path.join(standaloneNextDir, 'static');
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, staticDest, { recursive: true });
  console.log('✓ Copied .next/static into standalone bundle');
} else {
  console.warn('⚠ .next/static not found, skipping static asset copy');
}

// Copy public assets so browser requests can resolve in standalone mode
const publicSrc = path.join(projectRoot, 'public');
const publicDest = path.join(standaloneDir, 'public');
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true });
  console.log('✓ Copied public assets into standalone bundle');
} else {
  console.warn('⚠ public directory not found, skipping public asset copy');
}

// Make cli.js executable
const cliPath = path.join(__dirname, 'cli.js');
if (fs.existsSync(cliPath)) {
  fs.chmodSync(cliPath, '755');
  console.log('✓ Made cli.js executable');
}

console.log('✓ Postbuild tasks completed');
