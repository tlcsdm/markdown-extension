const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');
const commonDir = path.join(srcDir, 'common');

// Get build target from command line args
const target = process.argv[2]; // 'chrome', 'edge', or undefined for both

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildExtension(browser) {
  console.log(`Building ${browser} extension...`);

  const browserSrcDir = path.join(srcDir, browser);
  const browserDistDir = path.join(distDir, browser);

  // Check if source exists
  if (!fs.existsSync(browserSrcDir)) {
    console.error(`Source directory not found: ${browserSrcDir}`);
    process.exit(1);
  }

  // Clean dist directory
  if (fs.existsSync(browserDistDir)) {
    fs.rmSync(browserDistDir, { recursive: true });
  }

  // Copy browser-specific files (manifest.json, background.js)
  copyDir(browserSrcDir, browserDistDir);

  // Copy common files (shared between Chrome and Edge)
  copyDir(commonDir, browserDistDir);

  console.log(`${browser} extension built successfully at: ${browserDistDir}`);
}

function main() {
  // Create dist directory if it doesn't exist
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  if (target) {
    if (target !== 'chrome' && target !== 'edge') {
      console.error(`Invalid target: ${target}. Use 'chrome' or 'edge'.`);
      process.exit(1);
    }
    buildExtension(target);
  } else {
    // Build both
    buildExtension('chrome');
    buildExtension('edge');
  }

  console.log('\nBuild completed!');
}

main();
