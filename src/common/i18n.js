// Internationalization (i18n) module
(function () {
  'use strict';

  const supportedLocales = ['en', 'zh', 'ja'];
  const defaultLocale = 'en';
  let currentLocale = defaultLocale;
  let messages = {};

  function getBrowserLanguage() {
    const lang = navigator.language || navigator.userLanguage || '';
    return lang.split('-')[0].toLowerCase();
  }

  function determineLocale() {
    try {
      const savedLocale = localStorage.getItem('mdViewer_locale');
      if (savedLocale && supportedLocales.includes(savedLocale)) {
        return savedLocale;
      }
    } catch (e) {
      console.warn('Unable to read saved locale:', e);
    }

    const browserLang = getBrowserLanguage();
    if (supportedLocales.includes(browserLang)) {
      return browserLang;
    }

    return defaultLocale;
  }

  async function loadMessages(locale) {
    try {
      const response = await fetch(`_locales/${locale}/messages.json`);
      if (!response.ok) {
        throw new Error(`Failed to load locale: ${locale}`);
      }
      return await response.json();
    } catch (error) {
      console.warn(`Failed to load locale ${locale}, falling back to ${defaultLocale}:`, error);
      if (locale !== defaultLocale) {
        return loadMessages(defaultLocale);
      }
      return {};
    }
  }

  function getMessage(key) {
    if (messages[key] && messages[key].message) {
      return messages[key].message;
    }
    return key;
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.getAttribute('data-i18n');
      const message = getMessage(key);
      if (message !== key) {
        element.textContent = message;
      }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      const message = getMessage(key);
      if (message !== key) {
        element.title = message;
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
      const key = element.getAttribute('data-i18n-placeholder');
      const message = getMessage(key);
      if (message !== key) {
        element.placeholder = message;
      }
    });

    document.documentElement.lang = currentLocale;
  }

  async function initI18n() {
    currentLocale = determineLocale();
    messages = await loadMessages(currentLocale);
    applyI18n();
  }

  window.i18n = {
    init: initI18n,
    getMessage: getMessage,
    getCurrentLocale: () => currentLocale,
    getSupportedLocales: () => supportedLocales,
    setLocale: async (locale) => {
      if (supportedLocales.includes(locale)) {
        currentLocale = locale;
        messages = await loadMessages(locale);
        try {
          localStorage.setItem('mdViewer_locale', locale);
        } catch (e) {
          console.warn('Unable to save locale:', e);
        }
        applyI18n();
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
  } else {
    initI18n();
  }
})();
