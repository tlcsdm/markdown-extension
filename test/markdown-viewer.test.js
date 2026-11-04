const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const zlib = require('node:zlib');

const scriptPath = path.join(__dirname, '..', 'src', 'common', 'markdown-viewer.js');
const source = fs.readFileSync(scriptPath, 'utf8');

function createButton() {
  return {
    active: false,
    classList: {
      toggle(name, force) {
        if (name === 'active') {
          this._owner.active = !!force;
        }
      },
      _owner: null
    }
  };
}

function createFileTitle() {
  return {
    textContent: '',
    missing: false,
    classList: {
      toggle(name, force) {
        if (name === 'missing-file') {
          this._owner.missing = !!force;
        }
      },
      _owner: null
    }
  };
}

function loadViewerHooks({
  prefersDark = false,
  savedTheme = 'auto',
  throwOnSetTheme = false,
  clipboardWriteText = null,
  pako = {
    deflate: (bytes) => bytes,
    deflateRaw: (bytes) => bytes
  }
} = {}) {
  const attrs = {};
  const lightSheet = { disabled: false };
  const darkSheet = { disabled: true };
  const lightBtn = createButton();
  const darkBtn = createButton();
  const autoBtn = createButton();
  const fileTitle = createFileTitle();
  lightBtn.classList._owner = lightBtn;
  darkBtn.classList._owner = darkBtn;
  autoBtn.classList._owner = autoBtn;
  fileTitle.classList._owner = fileTitle;

  const elementMap = {
    'hljs-light-theme': lightSheet,
    'hljs-dark-theme': darkSheet,
    'theme-light-btn': lightBtn,
    'theme-dark-btn': darkBtn,
    'theme-auto-btn': autoBtn,
    'file-title': fileTitle
  };

  const context = {
    window: {
      matchMedia: () => ({ matches: prefersDark, addEventListener: () => {} }),
      pako
    },
    document: {
      readyState: 'loading',
      documentElement: {
        setAttribute: (name, value) => { attrs[name] = value; },
        getAttribute: (name) => attrs[name]
      },
      getElementById: (id) => elementMap[id] || null,
      addEventListener: () => {}
    },
    localStorage: {
      getItem: () => savedTheme,
      setItem: () => {
        if (throwOnSetTheme) {
          throw new Error('write failed');
        }
      }
    },
    navigator: clipboardWriteText ? { clipboard: { writeText: clipboardWriteText } } : {},
    history: { replaceState: () => {} },
    URLSearchParams,
    URL,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    TextEncoder,
    alert: () => {},
    console
  };

  const instrumented = source.replace(
    "if (document.readyState === 'loading') {",
    "window.__mdViewerTestHooks = { applyTheme, loadSavedTheme, slugify, escapeHtml, encodePlantuml, setFileMissingState, normalizePlantumlServer, buildPlantumlImageUrl, copyPlantumlSource }; if (document.readyState === 'loading') {"
  );

  vm.runInNewContext(instrumented, context, { filename: scriptPath });

  return {
    hooks: context.window.__mdViewerTestHooks,
    attrs,
    lightSheet,
    darkSheet,
    lightBtn,
    darkBtn,
    autoBtn,
    fileTitle
  };
}

test('markdown-viewer applyTheme supports dark and auto branches', () => {
  const env = loadViewerHooks({ prefersDark: true });
  env.hooks.applyTheme('dark');
  assert.equal(env.attrs['data-theme'], 'dark');
  assert.equal(env.lightSheet.disabled, true);
  assert.equal(env.darkSheet.disabled, false);
  assert.equal(env.darkBtn.active, true);

  env.hooks.applyTheme('auto');
  assert.equal(env.attrs['data-theme'], 'dark');
  assert.equal(env.autoBtn.active, true);
});

test('markdown-viewer loadSavedTheme falls back to auto when storage read fails', () => {
  const env = loadViewerHooks({ prefersDark: false, throwOnSetTheme: true });
  env.hooks.loadSavedTheme();
  assert.equal(env.attrs['data-theme'], 'light');
});

test('markdown-viewer utility helpers run expected branches', () => {
  const env = loadViewerHooks({ prefersDark: false });
  assert.equal(env.hooks.slugify(' Hello, 世界! 123 '), 'hello-世界-123');
  assert.equal(env.hooks.escapeHtml('<a&"b">'), '&lt;a&amp;&quot;b&quot;&gt;');

  const encoded = env.hooks.encodePlantuml('abc');
  assert.equal(typeof encoded, 'string');
  assert.ok(encoded.length > 0);
});

test('markdown-viewer setFileMissingState toggles missing title style', () => {
  const env = loadViewerHooks({ prefersDark: false });
  env.hooks.setFileMissingState(true);
  assert.equal(env.fileTitle.missing, true);
  env.hooks.setFileMissingState(false);
  assert.equal(env.fileTitle.missing, false);
});

test('markdown-viewer uses Kroki-compatible encoding for default PlantUML server', () => {
  const pako = {
    deflate: (bytes) => zlib.deflateSync(Buffer.from(bytes)),
    deflateRaw: (bytes) => zlib.deflateRawSync(Buffer.from(bytes))
  };
  const env = loadViewerHooks({ pako });
  const diagram = '@startuml\nAlice -> Bob: hello\n@enduml';
  const expectedPayload = zlib
    .deflateSync(Buffer.from(diagram, 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const actualUrl = env.hooks.buildPlantumlImageUrl(diagram, 'https://kroki.io');

  assert.equal(actualUrl, `https://kroki.io/plantuml/svg/${expectedPayload}`);
});

test('markdown-viewer supports custom PlantUML server endpoint', () => {
  const env = loadViewerHooks();
  const diagram = '@startuml\nBob -> Alice: hi\n@enduml';
  const actualUrl = env.hooks.buildPlantumlImageUrl(diagram, 'https://www.plantuml.com/plantuml/');

  assert.ok(actualUrl.startsWith('https://www.plantuml.com/plantuml/svg/'));
  assert.equal(env.hooks.normalizePlantumlServer('  '), 'https://kroki.io');
  assert.equal(env.hooks.normalizePlantumlServer('javascript:alert(1)'), 'https://kroki.io');
});

test('markdown-viewer copyPlantumlSource handles clipboard availability', async () => {
  const writes = [];
  const withClipboard = loadViewerHooks({
    clipboardWriteText: async (text) => { writes.push(text); }
  });
  assert.equal(await withClipboard.hooks.copyPlantumlSource('@startuml'), true);
  assert.deepEqual(writes, ['@startuml']);

  const withoutClipboard = loadViewerHooks();
  assert.equal(await withoutClipboard.hooks.copyPlantumlSource('@startuml'), false);
});
