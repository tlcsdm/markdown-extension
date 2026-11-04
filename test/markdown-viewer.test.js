const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

function loadViewerHooks({ prefersDark = false, savedTheme = 'auto', throwOnSetTheme = false, storageEntries = {} } = {}) {
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

  const storage = new Map(Object.entries({
    mdViewer_themeMode: savedTheme,
    ...storageEntries
  }));

  const context = {
    window: {
      matchMedia: () => ({ matches: prefersDark, addEventListener: () => {} })
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
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => {
        if (throwOnSetTheme && key === 'mdViewer_themeMode') {
          throw new Error('write failed');
        }
        storage.set(key, String(value));
      }
    },
    history: { replaceState: () => {} },
    URLSearchParams,
    URL,
    alert: () => {},
    console
  };

  const instrumented = source.replace(
    "if (document.readyState === 'loading') {",
    "window.__mdViewerTestHooks = { applyTheme, loadSavedTheme, slugify, escapeHtml, encodePlantuml, setFileMissingState, normalizePlantumlServer, getPlantumlRenderSettings }; if (document.readyState === 'loading') {"
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

test('markdown-viewer plantuml settings default to local rendering', () => {
  const env = loadViewerHooks();
  const settings = env.hooks.getPlantumlRenderSettings();
  assert.equal(settings.useLocal, true);
  assert.equal(settings.useServer, false);
  assert.equal(settings.server, 'https://kroki.io');
});

test('markdown-viewer plantuml settings normalize custom server mode', () => {
  const env = loadViewerHooks({
    storageEntries: {
      mdViewer_plantumlUseLocal: 'false',
      mdViewer_plantumlUseServer: 'true',
      mdViewer_plantumlServer: 'https://example.com/'
    }
  });
  const settings = env.hooks.getPlantumlRenderSettings();
  assert.equal(settings.useLocal, false);
  assert.equal(settings.useServer, true);
  assert.equal(settings.server, 'https://example.com');
  assert.equal(env.hooks.normalizePlantumlServer(' https://x.test/ '), 'https://x.test');
});
