const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'src', 'common', 'theme-init.js');
const code = fs.readFileSync(scriptPath, 'utf8');

function runThemeInit({ savedMode, prefersDark = false, throwOnRead = false }) {
  let appliedTheme = null;

  const context = {
    localStorage: {
      getItem: () => {
        if (throwOnRead) {
          throw new Error('read failed');
        }
        return savedMode;
      }
    },
    window: {
      matchMedia: () => ({ matches: prefersDark })
    },
    document: {
      documentElement: {
        setAttribute: (name, value) => {
          if (name === 'data-theme') {
            appliedTheme = value;
          }
        }
      }
    }
  };

  vm.runInNewContext(code, context, { filename: scriptPath });
  return appliedTheme;
}

test('theme-init applies dark when saved mode is dark', () => {
  assert.equal(runThemeInit({ savedMode: 'dark', prefersDark: false }), 'dark');
});

test('theme-init applies dark for auto mode when system prefers dark', () => {
  assert.equal(runThemeInit({ savedMode: 'auto', prefersDark: true }), 'dark');
});

test('theme-init defaults to light for unsupported saved mode', () => {
  assert.equal(runThemeInit({ savedMode: 'light', prefersDark: true }), 'light');
});

test('theme-init silently handles localStorage errors', () => {
  assert.equal(runThemeInit({ throwOnRead: true, prefersDark: true }), null);
});
