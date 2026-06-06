const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

const standaloneDir = path.join(__dirname, '..', '.next', 'standalone');
if (fs.existsSync(standaloneDir)) {
  console.log('Copying static assets to standalone directory...');
  copyRecursiveSync(path.join(__dirname, '..', 'public'), path.join(standaloneDir, 'public'));
  
  const staticDest = path.join(standaloneDir, '.next', 'static');
  if (!fs.existsSync(staticDest)) fs.mkdirSync(staticDest, { recursive: true });
  copyRecursiveSync(path.join(__dirname, '..', '.next', 'static'), staticDest);
  console.log('Done!');
}
