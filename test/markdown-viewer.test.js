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

function loadViewerHooks({ prefersDark = false, savedTheme = 'auto', throwOnSetTheme = false } = {}) {
  const attrs = {};
  const lightSheet = { disabled: false };
  const darkSheet = { disabled: true };
  const lightBtn = createButton();
  const darkBtn = createButton();
  const autoBtn = createButton();
  lightBtn.classList._owner = lightBtn;
  darkBtn.classList._owner = darkBtn;
  autoBtn.classList._owner = autoBtn;

  const elementMap = {
    'hljs-light-theme': lightSheet,
    'hljs-dark-theme': darkSheet,
    'theme-light-btn': lightBtn,
    'theme-dark-btn': darkBtn,
    'theme-auto-btn': autoBtn
  };

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
      getItem: () => savedTheme,
      setItem: () => {
        if (throwOnSetTheme) {
          throw new Error('write failed');
        }
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
    "window.__mdViewerTestHooks = { applyTheme, loadSavedTheme, slugify, escapeHtml, encodePlantuml }; if (document.readyState === 'loading') {"
  );

  vm.runInNewContext(instrumented, context, { filename: scriptPath });

  return {
    hooks: context.window.__mdViewerTestHooks,
    attrs,
    lightSheet,
    darkSheet,
    lightBtn,
    darkBtn,
    autoBtn
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
