const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runBackgroundScript(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const listeners = {};
  const calls = { created: [], zoom: [] };
  const viewerUrl = 'chrome-extension://id/markdown-viewer.html';

  const chrome = {
    runtime: {
      getURL: (resource) => `chrome-extension://id/${resource}`
    },
    action: {
      onClicked: {
        addListener: (fn) => {
          listeners.onClicked = fn;
        }
      }
    },
    tabs: {
      create: (options, callback) => {
        calls.created.push(options);
        callback({ id: 123 });
      },
      setZoomSettings: (tabId, settings) => {
        calls.zoom.push({ tabId, settings });
      },
      onUpdated: {
        addListener: (fn) => {
          listeners.onUpdated = fn;
        }
      }
    }
  };

  vm.runInNewContext(code, { chrome, console }, { filename: filePath });
  return { listeners, calls, viewerUrl };
}

for (const browser of ['chrome', 'edge']) {
  const scriptPath = path.join(__dirname, '..', 'src', browser, 'background.js');

  test(`${browser} background opens viewer with per-tab zoom`, () => {
    const { listeners, calls, viewerUrl } = runBackgroundScript(scriptPath);

    assert.equal(typeof listeners.onClicked, 'function');
    listeners.onClicked();

    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].url, viewerUrl);
    assert.equal(calls.zoom.length, 1);
    assert.equal(calls.zoom[0].tabId, 123);
    assert.equal(calls.zoom[0].settings.scope, 'per-tab');
  });

  test(`${browser} background applies zoom only for matching loading tabs`, () => {
    const { listeners, calls, viewerUrl } = runBackgroundScript(scriptPath);

    assert.equal(typeof listeners.onUpdated, 'function');

    listeners.onUpdated(7, { status: 'complete', url: viewerUrl });
    listeners.onUpdated(8, { status: 'loading', url: 'https://example.com/readme.md' });
    listeners.onUpdated(9, { status: 'loading', url: viewerUrl });

    assert.equal(calls.zoom.length, 1);
    assert.equal(calls.zoom[0].tabId, 9);
    assert.equal(calls.zoom[0].settings.scope, 'per-tab');
  });
}
