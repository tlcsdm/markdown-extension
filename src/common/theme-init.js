// Early theme detection to prevent flash of wrong theme
(function () {
  try {
    var savedMode = sessionStorage.getItem('mdViewer_themeMode');
    var theme = 'light';
    if (savedMode === 'dark') {
      theme = 'dark';
    } else if (savedMode === 'auto' || !savedMode) {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        theme = 'dark';
      }
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
