const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'src', 'common', 'i18n.js');
const code = fs.readFileSync(scriptPath, 'utf8');

function createElement(attributeName, key) {
  return {
    textContent: '',
    title: '',
    placeholder: '',
    getAttribute: (name) => (name === attributeName ? key : null)
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runI18n({
  savedLocale,
  browserLanguage,
  fetchResponses,
  fetchRejectLocales = []
}) {
  const textElement = createElement('data-i18n', 'openFile');
  const titleElement = createElement('data-i18n-title', 'themeDark');
  const placeholderElement = createElement('data-i18n-placeholder', 'search');

  const setCalls = [];

  const context = {
    navigator: {
      language: browserLanguage
    },
    localStorage: {
      getItem: (key) => (key === 'mdViewer_locale' ? savedLocale : null),
      setItem: (key, value) => {
        setCalls.push({ key, value });
      }
    },
    fetch: async (url) => {
      const locale = url.match(/_locales\/(.+)\/messages\.json$/)[1];
      if (fetchRejectLocales.includes(locale)) {
        throw new Error(`fetch failed for ${locale}`);
      }

      const payload = fetchResponses[locale];
      if (!payload) {
        return { ok: false, json: async () => ({}) };
      }

      return {
        ok: true,
        json: async () => payload
      };
    },
    document: {
      readyState: 'complete',
      documentElement: { lang: '' },
      querySelectorAll: (selector) => {
        if (selector === '[data-i18n]') {
          return [textElement];
        }
        if (selector === '[data-i18n-title]') {
          return [titleElement];
        }
        if (selector === '[data-i18n-placeholder]') {
          return [placeholderElement];
        }
        return [];
      },
      addEventListener: () => {}
    },
    window: {},
    console
  };

  vm.runInNewContext(code, context, { filename: scriptPath });
  await flushAsyncWork();

  return {
    i18n: context.window.i18n,
    textElement,
    titleElement,
    placeholderElement,
    lang: context.document.documentElement.lang,
    setCalls
  };
}

test('i18n uses saved supported locale and applies messages', async () => {
  const env = await runI18n({
    savedLocale: 'zh',
    browserLanguage: 'en-US',
    fetchResponses: {
      zh: {
        openFile: { message: '打开文件' },
        themeDark: { message: '深色模式' },
        search: { message: '搜索' }
      }
    }
  });

  assert.equal(env.i18n.getCurrentLocale(), 'zh');
  assert.equal(env.lang, 'zh');
  assert.equal(env.textElement.textContent, '打开文件');
  assert.equal(env.titleElement.title, '深色模式');
  assert.equal(env.placeholderElement.placeholder, '搜索');
});

test('i18n falls back to browser language when saved locale is unsupported', async () => {
  const env = await runI18n({
    savedLocale: 'fr',
    browserLanguage: 'ja-JP',
    fetchResponses: {
      ja: {
        openFile: { message: 'ファイルを開く' },
        themeDark: { message: 'ダーク' },
        search: { message: '検索' }
      }
    }
  });

  assert.equal(env.i18n.getCurrentLocale(), 'ja');
  assert.equal(env.lang, 'ja');
});

test('i18n loadMessages falls back to default locale when fetch fails', async () => {
  const env = await runI18n({
    savedLocale: null,
    browserLanguage: 'zh-CN',
    fetchResponses: {
      en: {
        openFile: { message: 'Open File' },
        themeDark: { message: 'Dark' },
        search: { message: 'Search' }
      }
    },
    fetchRejectLocales: ['zh']
  });

  assert.equal(env.i18n.getCurrentLocale(), 'zh');
  assert.equal(env.textElement.textContent, 'Open File');
});

test('i18n setLocale ignores unsupported locale and saves supported locale', async () => {
  const env = await runI18n({
    savedLocale: 'en',
    browserLanguage: 'en-US',
    fetchResponses: {
      en: {
        openFile: { message: 'Open File' },
        themeDark: { message: 'Dark' },
        search: { message: 'Search' }
      },
      zh: {
        openFile: { message: '打开文件' },
        themeDark: { message: '深色' },
        search: { message: '搜索' }
      }
    }
  });

  await env.i18n.setLocale('fr');
  assert.equal(env.i18n.getCurrentLocale(), 'en');

  await env.i18n.setLocale('zh');
  assert.equal(env.i18n.getCurrentLocale(), 'zh');
  assert.deepEqual(env.setCalls, [{ key: 'mdViewer_locale', value: 'zh' }]);
});
