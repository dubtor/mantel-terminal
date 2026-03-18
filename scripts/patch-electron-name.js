// Patches the Electron.app Info.plist to show "Mantel" instead of "Electron"
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const plist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist');

if (!fs.existsSync(plist)) {
  console.log('Electron plist not found, skipping name patch.');
  process.exit(0);
}

const name = 'Mantel';

try {
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName '${name}'" "${plist}"`);
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName '${name}'" "${plist}"`);
  console.log(`Patched Electron.app name to "${name}"`);
} catch (e) {
  console.error('Failed to patch Electron name:', e.message);
}
