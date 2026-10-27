/**
 * Downloads and copies library files from node_modules to src/common/lib/.
 * Run this script with `npm run setup` after `npm install` to refresh bundled libraries.
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const libDir = path.join(rootDir, 'src', 'common', 'lib');

if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

function copyLib(src, dest) {
  const srcPath = path.join(rootDir, 'node_modules', src);
  const destPath = path.join(libDir, dest);

  if (!fs.existsSync(srcPath)) {
    console.error(`Source not found: ${srcPath}`);
    process.exit(1);
  }

  fs.copyFileSync(srcPath, destPath);
  const size = (fs.statSync(destPath).size / 1024).toFixed(1);
  console.log(`Copied ${dest} (${size} KB)`);
}

console.log('Downloading library files from node_modules...\n');

// markdown-it - Markdown parser (VSCode rendering engine)
copyLib('markdown-it/dist/browser/markdown-it.umd.min.js', 'markdown-it.min.js');

// mermaid - Diagram rendering
copyLib('mermaid/dist/mermaid.min.js', 'mermaid.min.js');

// pako - deflate for PlantUML encoding
copyLib('pako/dist/browser/pako_deflate.umd.min.js', 'pako_deflate.min.js');

console.log('\nLibrary files updated in src/common/lib/');
console.log('Note: highlight.js CSS and JS are bundled from node_modules.');
console.log('Run `npm install` then `npm run setup` to refresh all library files.');
