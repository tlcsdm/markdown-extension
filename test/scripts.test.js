const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function copyScript(tmpRoot, fileName) {
  const scriptSource = path.join(repoRoot, 'scripts', fileName);
  const scriptDest = path.join(tmpRoot, 'scripts', fileName);
  writeFile(scriptDest, fs.readFileSync(scriptSource, 'utf8'));
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

function runScriptInVm(scriptPath, { argv, fsMock }) {
  const code = fs.readFileSync(scriptPath, 'utf8');
  let exitCode = null;
  const processMock = {
    argv: ['node', scriptPath, ...argv],
    exit: (code) => {
      exitCode = code;
      throw new Error(`__EXIT__${code}`);
    }
  };

  const context = {
    require: (name) => {
      if (name === 'fs') return fsMock;
      if (name === 'path') return path;
      return require(name);
    },
    __dirname: path.dirname(scriptPath),
    process: processMock,
    console: { log: () => {}, error: () => {}, warn: () => {} }
  };

  try {
    vm.runInNewContext(code, context, { filename: scriptPath });
  } catch (error) {
    if (!String(error.message).startsWith('__EXIT__')) {
      throw error;
    }
  }

  return exitCode;
}

function createBuildFixture({ includeChrome = true, includeEdge = true } = {}) {
  const tmpRoot = makeTmpDir('md-build-');
  copyScript(tmpRoot, 'build.js');

  writeFile(path.join(tmpRoot, 'src/common/markdown-viewer.html'), '<html></html>');

  if (includeChrome) {
    writeFile(path.join(tmpRoot, 'src/chrome/manifest.json'), '{"name":"chrome"}');
    writeFile(path.join(tmpRoot, 'src/chrome/background.js'), 'console.log("chrome")');
  }

  if (includeEdge) {
    writeFile(path.join(tmpRoot, 'src/edge/manifest.json'), '{"name":"edge"}');
    writeFile(path.join(tmpRoot, 'src/edge/background.js'), 'console.log("edge")');
  }

  return tmpRoot;
}

function createDownloadFixture({ includeAllSources = true } = {}) {
  const tmpRoot = makeTmpDir('md-download-');
  copyScript(tmpRoot, 'download-libs.js');

  if (includeAllSources) {
    writeFile(path.join(tmpRoot, 'node_modules/markdown-it/dist/browser/markdown-it.umd.min.js'), 'markdown-it');
    writeFile(path.join(tmpRoot, 'node_modules/mermaid/dist/mermaid.min.js'), 'mermaid');
    writeFile(path.join(tmpRoot, 'node_modules/pako/dist/browser/pako_deflate.umd.min.js'), 'pako');
  } else {
    writeFile(path.join(tmpRoot, 'node_modules/markdown-it/dist/browser/markdown-it.umd.min.js'), 'markdown-it');
  }

  return tmpRoot;
}

test('build script builds chrome target successfully', () => {
  const result = runNode(['scripts/build.js', 'chrome'], repoRoot);

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(repoRoot, 'dist/chrome/manifest.json')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'dist/chrome/markdown-viewer.html')), true);
});

test('build script builds both browsers by default', () => {
  const result = runNode(['scripts/build.js'], repoRoot);

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(repoRoot, 'dist/chrome/manifest.json')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'dist/edge/manifest.json')), true);
});

test('build script rejects invalid target', () => {
  const result = runNode(['scripts/build.js', 'firefox'], repoRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid target: firefox/);
});

test('build script exits when target source directory is missing', () => {
  const tmpRoot = createBuildFixture({ includeChrome: false, includeEdge: true });
  const result = runNode(['scripts/build.js', 'chrome'], tmpRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source directory not found/);
});

test('build script creates dist directory when missing', () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'build.js');
  const calls = [];
  const fsMock = {
    existsSync: (inputPath) => {
      if (inputPath.endsWith(path.join('markdown-extension', 'dist'))) return false;
      return true;
    },
    mkdirSync: (dir, options) => { calls.push({ dir, options }); },
    readdirSync: () => [],
    copyFileSync: () => {},
    rmSync: () => {}
  };

  const exitCode = runScriptInVm(scriptPath, { argv: ['chrome'], fsMock });
  assert.equal(exitCode, null);
  assert.equal(calls.length > 0, true);
});

test('build script exits for missing browser source branch in script path', () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'build.js');
  const fsMock = {
    existsSync: (inputPath) => !inputPath.endsWith(path.join('src', 'chrome')),
    mkdirSync: () => {},
    readdirSync: () => [],
    copyFileSync: () => {},
    rmSync: () => {}
  };

  const exitCode = runScriptInVm(scriptPath, { argv: ['chrome'], fsMock });
  assert.equal(exitCode, 1);
});

test('download-libs copies expected library files', () => {
  const tmpRoot = createDownloadFixture({ includeAllSources: true });
  const result = runNode(['scripts/download-libs.js'], tmpRoot);

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(tmpRoot, 'src/common/lib/markdown-it.min.js')), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, 'src/common/lib/mermaid.min.js')), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, 'src/common/lib/pako_deflate.min.js')), true);
});

test('download-libs exits when a source library is missing', () => {
  const tmpRoot = createDownloadFixture({ includeAllSources: false });
  const result = runNode(['scripts/download-libs.js'], tmpRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source not found/);
});

test('download-libs creates lib directory when missing', () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'download-libs.js');
  const calls = [];
  const fsMock = {
    existsSync: (inputPath) => {
      if (inputPath.endsWith(path.join('src', 'common', 'lib'))) return false;
      return true;
    },
    mkdirSync: (dir, options) => { calls.push({ dir, options }); },
    copyFileSync: () => {},
    statSync: () => ({ size: 2048 })
  };

  const exitCode = runScriptInVm(scriptPath, { argv: [], fsMock });
  assert.equal(exitCode, null);
  assert.equal(calls.length > 0, true);
});

test('download-libs exits when required source is missing in script branch', () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'download-libs.js');
  const fsMock = {
    existsSync: (inputPath) => !inputPath.includes(path.join('mermaid', 'dist', 'mermaid.min.js')),
    mkdirSync: () => {},
    copyFileSync: () => {},
    statSync: () => ({ size: 2048 })
  };

  const exitCode = runScriptInVm(scriptPath, { argv: [], fsMock });
  assert.equal(exitCode, 1);
});
