// Markdown Viewer - Main Script (uses markdown-it, mirroring VSCode rendering)
(function () {
  'use strict';

  // ===== State =====
  let currentFileText = null;
  let currentFileName = null;
  let currentFileHandle = null;
  let currentFileMeta = null;
  let fileWatchTimer = null;
  let themeMode = 'auto';
  let isSidebarCollapsed = false;
  const plantumlServerStorageKey = 'mdViewer_plantumlServer';
  const defaultPlantumlServer = 'https://kroki.io';

  // ===== DOM References =====
  const dropZone = document.getElementById('drop-zone');
  const markdownBody = document.getElementById('markdown-body');
  const sidebar = document.getElementById('sidebar');
  const tocList = document.getElementById('toc-list');
  const fileTitle = document.getElementById('file-title');
  const openFileBtn = document.getElementById('open-file-btn');
  const fileInput = document.getElementById('file-input');
  const linkedFileInput = document.getElementById('linked-file-input');
  const contentArea = document.getElementById('content-area');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarResizer = document.getElementById('sidebar-resizer');
  const tocScrollWrapper = document.getElementById('toc-scroll-wrapper');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDialog = document.getElementById('settings-dialog');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');
  const plantumlServerInput = document.getElementById('plantuml-server-input');

  // ===== PlantUML Encoder =====
  const pumlAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

  function encode6bit(b) {
    return pumlAlphabet[b & 63];
  }

  function append3bytes(b1, b2, b3) {
    return (
      encode6bit(b1 >> 2) +
      encode6bit(((b1 & 0x3) << 4) | (b2 >> 4)) +
      encode6bit(((b2 & 0xf) << 2) | (b3 >> 6)) +
      encode6bit(b3 & 0x3f)
    );
  }

  function encodePlantuml(text) {
    const utf8 = unescape(encodeURIComponent(text));
    const bytes = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) bytes[i] = utf8.charCodeAt(i);
    const compressed = window.pako ? window.pako.deflateRaw(bytes) : bytes;
    let result = '';
    const len = compressed.length;
    for (let i = 0; i < len; i += 3) {
      if (i + 2 < len) result += append3bytes(compressed[i], compressed[i + 1], compressed[i + 2]);
      else if (i + 1 < len) result += append3bytes(compressed[i], compressed[i + 1], 0);
      else result += append3bytes(compressed[i], 0, 0);
    }
    return result;
  }

  function normalizePlantumlServer(server) {
    let normalized = String(server || '').trim().replace(/\/+$/, '');
    if (!normalized) return defaultPlantumlServer;
    if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return defaultPlantumlServer;
      }
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    } catch (e) {
      return defaultPlantumlServer;
    }
  }

  function getPlantumlServer() {
    return normalizePlantumlServer(localStorage.getItem(plantumlServerStorageKey));
  }

  function encodeBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function encodeKroki(text) {
    const bytes = new TextEncoder().encode(text);
    const compressed = window.pako && typeof window.pako.deflate === 'function'
      ? window.pako.deflate(bytes)
      : bytes;
    return encodeBase64Url(compressed);
  }

  function isPlantumlServer(server) {
    const path = new URL(server).pathname.toLowerCase();
    return path.endsWith('/plantuml') || path.includes('/plantuml/');
  }

  function buildPlantumlImageUrl(code, serverInput) {
    const server = normalizePlantumlServer(serverInput);
    if (isPlantumlServer(server)) {
      return `${server}/svg/${encodePlantuml(code)}`;
    }
    return `${server}/plantuml/svg/${encodeKroki(code)}`;
  }

  // ===== Mermaid =====
  function initMermaid() {
    if (typeof mermaid === 'undefined') return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      });
    } catch (e) {
      console.warn('Mermaid init failed:', e);
    }
  }

  // ===== markdown-it setup (VSCode style) =====
  let md;

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\u00C0-\u024F\u4e00-\u9fff\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setupMarkdownIt() {
    if (typeof markdownit === 'undefined') {
      console.error('markdown-it not loaded');
      return;
    }

    md = markdownit({
      html: true,
      linkify: true,
      typographer: false,
      breaks: false,
      highlight: function (code, lang) {
        // Handled via custom fence rule; this fallback is for inline highlight
        if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          } catch (e) {}
        }
        if (typeof hljs !== 'undefined') {
          return hljs.highlightAuto(code).value;
        }
        return escapeHtml(code);
      }
    });

    // ── Custom fence rule for mermaid / plantuml ──────────────────────────
    const defaultFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.fence = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      const info = (token.info || '').trim().toLowerCase();
      const content = token.content;

      if (info === 'mermaid') {
        return `<div class="mermaid-block" data-mermaid="${escapeHtml(content)}">
          <div class="loading-spinner"></div>
        </div>\n`;
      }

      if (info === 'plantuml' || info === 'puml') {
        return `<div class="plantuml-block" data-plantuml="${escapeHtml(content)}">
          <div class="loading-spinner"></div>
        </div>\n`;
      }

      // Regular code block
      const lang = token.info.trim().split(/\s+/)[0];
      let highlighted;
      if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
        } catch (e) {}
      }
      if (!highlighted && typeof hljs !== 'undefined') {
        highlighted = hljs.highlightAuto(content).value;
      }
      if (!highlighted) {
        highlighted = escapeHtml(content);
      }
      const langClass = lang ? ` class="hljs language-${escapeHtml(lang)}"` : ' class="hljs"';
      return `<pre><code${langClass}>${highlighted}</code></pre>\n`;
    };

    // ── Override heading_open to inject IDs (VSCode style) ────────────────
    md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      // Find the inline token (next token)
      const inlineToken = tokens[idx + 1];
      const text = inlineToken ? inlineToken.children
        .filter(t => t.type === 'text' || t.type === 'code_inline')
        .map(t => t.content)
        .join('') : '';
      const id = slugify(text);
      token.attrSet('id', id);
      return self.renderToken(tokens, idx, options);
    };

    // ── Override link_open to handle local .md links ───────────────────────
    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      const href = token.attrGet('href') || '';
      if (href.endsWith('.md') && !href.startsWith('http')) {
        token.attrSet('class', 'local-md-link');
        token.attrSet('data-md-link', href);
      } else if (href.startsWith('http')) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      }
      return self.renderToken(tokens, idx, options);
    };
  }

  // ===== Diagram rendering =====
  async function renderMermaidBlocks() {
    if (typeof mermaid === 'undefined') return;
    const blocks = markdownBody.querySelectorAll('.mermaid-block[data-mermaid]');
    for (const block of blocks) {
      const code = block.getAttribute('data-mermaid');
      try {
        const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
        const { svg } = await mermaid.render(id, code);
        block.innerHTML = svg;
      } catch (e) {
        block.innerHTML = `<pre class="diagram-error">${escapeHtml(String(e.message || e))}</pre>`;
      }
    }
  }

  async function renderPlantumlBlocks() {
    const blocks = markdownBody.querySelectorAll('.plantuml-block[data-plantuml]');
    for (const block of blocks) {
      const code = block.getAttribute('data-plantuml');
      try {
        const img = document.createElement('img');
        img.src = buildPlantumlImageUrl(code, getPlantumlServer());
        img.alt = 'PlantUML diagram';
        img.style.maxWidth = '100%';
        img.addEventListener('error', () => {
          const errorElement = document.createElement('div');
          errorElement.className = 'diagram-error';
          errorElement.textContent = 'PlantUML render failed';
          block.textContent = '';
          block.appendChild(errorElement);
        }, { once: true });
        block.innerHTML = '';
        block.appendChild(img);
      } catch (e) {
        const errorElement = document.createElement('div');
        errorElement.className = 'diagram-error';
        errorElement.textContent = String(e.message || e);
        block.textContent = '';
        block.appendChild(errorElement);
      }
    }
  }

  // ===== TOC =====
  function buildTOC() {
    const headings = markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    tocList.innerHTML = '';

    if (headings.length === 0) {
      setSidebarVisible(false);
      return;
    }

    setSidebarVisible(true);

    headings.forEach(heading => {
      const level = parseInt(heading.tagName.slice(1));
      const id = heading.id || slugify(heading.textContent);
      if (!heading.id) heading.id = id;

      const li = document.createElement('li');
      li.className = `toc-h${level}`;
      const a = document.createElement('a');
      a.href = '#' + id;
      a.textContent = heading.textContent;
      li.appendChild(a);
      tocList.appendChild(li);
    });

    // Mark toc-list inert so Ctrl+F does not search sidebar text.
    // Click and hover events are handled via delegation on the sidebar element.
    tocList.setAttribute('inert', '');

    setupScrollSpy(headings);
  }

  function setSidebarVisible(visible) {
    sidebar.classList.toggle('hidden', !visible);
    sidebarResizer.classList.toggle('hidden', !visible || isSidebarCollapsed);
  }

  function setSidebarCollapsed(collapsed) {
    isSidebarCollapsed = collapsed;
    sidebar.classList.toggle('collapsed', collapsed);
    sidebarResizer.classList.toggle('hidden', collapsed || sidebar.classList.contains('hidden'));
    sidebarToggleBtn.textContent = collapsed ? '▶' : '◀';
    sidebarToggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  }

  function setFileMissingState(isMissing) {
    fileTitle.classList.toggle('missing-file', !!isMissing);
  }

  function setActiveTOC(activeLink) {
    tocList.querySelectorAll('a').forEach(a => a.classList.remove('active'));
    if (activeLink) activeLink.classList.add('active');
  }

  function setupScrollSpy(headings) {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const link = tocList.querySelector(`a[href="#${CSS.escape(entry.target.id)}"]`);
            setActiveTOC(link);
          }
        }
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 }
    );
    headings.forEach(h => observer.observe(h));
  }

  // ===== File Loading =====
  async function loadMarkdownText(text, filename, options = {}) {
    const preserveScroll = !!options.preserveScroll;
    const previousScrollTop = contentArea.scrollTop;
    currentFileText = text;
    currentFileName = filename;

    document.title = filename || 'Markdown Viewer';
    fileTitle.textContent = filename || 'Markdown Viewer';
    setFileMissingState(false);

    dropZone.classList.add('hidden');
    markdownBody.classList.remove('hidden');

    try {
      const html = md.render(text);
      markdownBody.innerHTML = html;
    } catch (e) {
      markdownBody.innerHTML = `<div class="diagram-error">Render error: ${escapeHtml(String(e.message || e))}</div>`;
      return;
    }

    buildTOC();
    contentArea.scrollTop = preserveScroll ? previousScrollTop : 0;

    initMermaid();
    await renderMermaidBlocks();
    await renderPlantumlBlocks();

    setupLocalLinks();
  }

  function setupLocalLinks() {
    markdownBody.querySelectorAll('a.local-md-link').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        linkedFileInput.setAttribute('data-hint', a.getAttribute('data-md-link'));
        linkedFileInput.click();
      });
    });
  }

  function stopFileWatch() {
    if (fileWatchTimer) {
      clearInterval(fileWatchTimer);
      fileWatchTimer = null;
    }
  }

  function startFileWatch() {
    stopFileWatch();
    if (!currentFileHandle) return;
    fileWatchTimer = setInterval(checkFileUpdates, 1500);
  }

  function setCurrentFileSource(fileHandle, file) {
    currentFileHandle = fileHandle || null;
    if (currentFileHandle && file) {
      currentFileMeta = { lastModified: file.lastModified, size: file.size };
      startFileWatch();
    } else {
      currentFileMeta = null;
      stopFileWatch();
    }
  }

  async function checkFileUpdates() {
    if (!currentFileHandle) return;
    try {
      const latestFile = await currentFileHandle.getFile();
      const changed = !currentFileMeta ||
        latestFile.lastModified !== currentFileMeta.lastModified ||
        latestFile.size !== currentFileMeta.size;
      if (!changed) return;

      currentFileMeta = { lastModified: latestFile.lastModified, size: latestFile.size };
      await loadMarkdownText(await latestFile.text(), latestFile.name, { preserveScroll: true });
    } catch (e) {
      setFileMissingState(e && e.name === 'NotFoundError');
      console.warn('File watch stopped:', e);
      setCurrentFileSource(null);
    }
  }

  async function loadFile(file, options = {}) {
    const allowInCurrentWindow = options.allowInCurrentWindow === true;
    const fileHandle = options.fileHandle || null;
    if (!file.name.match(/\.(md|markdown)$/i)) {
      const msg = window.i18n ? window.i18n.getMessage('invalidFileType') : 'Please drop a .md or .markdown file';
      alert(msg);
      return;
    }
    try {
      const text = await file.text();
      if (currentFileText && !allowInCurrentWindow) {
        await openFilePayloadInNewWindow({ text, filename: file.name });
        return;
      }
      setCurrentFileSource(fileHandle, file);
      await loadMarkdownText(text, file.name, { preserveScroll: false });
    } catch (e) {
      const msg = window.i18n ? window.i18n.getMessage('fileReadFailed') : 'Failed to read file';
      alert(msg);
    }
  }

  async function pickFileHandle() {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }]
    });
    if (!handles || handles.length === 0) return;
    const handle = handles[0];
    await openExistingFileInCurrentWindow(handle);
  }

  async function extractDroppedFileHandle(event) {
    const items = event.dataTransfer && event.dataTransfer.items ? Array.from(event.dataTransfer.items) : [];
    for (const item of items) {
      if (typeof item.getAsFileSystemHandle === 'function') {
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle && handle.kind === 'file') return handle;
        } catch (e) {}
      }
    }
    return null;
  }

  async function openFilePayloadInNewWindow(payload) {
    try {
      const transferKey = `mdViewer_transfer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(transferKey, JSON.stringify(payload));
      const url = new URL(window.location.href);
      url.searchParams.set('transfer', transferKey);
      window.open(url.toString(), '_blank', 'noopener');
    } catch (e) {
      if (payload && typeof payload.text === 'string') {
        await loadMarkdownText(payload.text, payload.filename || 'Markdown Viewer');
      }
    }
  }

  async function openDroppedFileInNewWindow(file) {
    try {
      await openFilePayloadInNewWindow({ text: await file.text(), filename: file.name });
    } catch (e) {
      await loadFile(file, { allowInCurrentWindow: true });
    }
  }

  async function openExistingFileInCurrentWindow(fileHandle) {
    try {
      const file = await fileHandle.getFile();
      await loadFile(file, { fileHandle, allowInCurrentWindow: true });
    } catch (e) {
      const msg = window.i18n ? window.i18n.getMessage('fileReadFailed') : 'Failed to read file';
      alert(msg);
    }
  }

  async function loadFromTransferIfPresent() {
    const params = new URLSearchParams(window.location.search);
    const transferKey = params.get('transfer');
    if (!transferKey) return;
    try {
      const raw = localStorage.getItem(transferKey);
      if (raw) {
        const data = JSON.parse(raw);
        localStorage.removeItem(transferKey);
        if (data && typeof data.text === 'string') {
          await loadMarkdownText(data.text, data.filename || 'Markdown Viewer');
        }
      }
    } catch (e) {}
    params.delete('transfer');
    const cleanQuery = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`;
    history.replaceState(null, '', cleanUrl);
  }

  // ===== Theme =====
  function applyTheme(mode) {
    themeMode = mode;
    let theme = 'light';
    if (mode === 'dark') {
      theme = 'dark';
    } else if (mode === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.documentElement.setAttribute('data-theme', theme);

    const lightSheet = document.getElementById('hljs-light-theme');
    const darkSheet = document.getElementById('hljs-dark-theme');
    if (lightSheet && darkSheet) {
      lightSheet.disabled = theme === 'dark';
      darkSheet.disabled = theme !== 'dark';
    }

    ['light', 'dark', 'auto'].forEach(m => {
      const btn = document.getElementById(`theme-${m}-btn`);
      if (btn) btn.classList.toggle('active', m === mode);
    });

    try { localStorage.setItem('mdViewer_themeMode', mode); } catch (e) {}

    if (currentFileText) {
      initMermaid();
      renderMermaidBlocks();
    }
  }

  function loadSavedTheme() {
    try {
      applyTheme(localStorage.getItem('mdViewer_themeMode') || 'auto');
    } catch (e) {
      applyTheme('auto');
    }
  }

  function loadPlantumlSettings() {
    if (plantumlServerInput) {
      plantumlServerInput.value = getPlantumlServer();
    }
  }

  // ===== Events =====
  function setupEvents() {
    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) { await loadFile(file); e.target.value = ''; }
    });

    linkedFileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) { await loadFile(file); e.target.value = ''; }
    });

    dropZone.addEventListener('click', async () => {
      if (window.showOpenFilePicker) {
        try {
          await pickFileHandle();
          return;
        } catch (e) {}
      }
      fileInput.click();
    });

    openFileBtn.addEventListener('click', async e => {
      if (!window.showOpenFilePicker) return;
      e.preventDefault();
      try {
        await pickFileHandle();
      } catch (error) {
        if (error && error.name !== 'AbortError') fileInput.click();
      }
    });

    document.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', e => {
      if (!e.relatedTarget) dropZone.classList.remove('drag-over');
    });
    document.addEventListener('drop', async e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (currentFileText) {
        await openDroppedFileInNewWindow(file);
        return;
      }
      const droppedHandle = await extractDroppedFileHandle(e);
      await loadFile(file, { fileHandle: droppedHandle });
    });

    document.getElementById('theme-light-btn').addEventListener('click', () => applyTheme('light'));
    document.getElementById('theme-dark-btn').addEventListener('click', () => applyTheme('dark'));
    document.getElementById('theme-auto-btn').addEventListener('click', () => applyTheme('auto'));

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeMode === 'auto') applyTheme('auto');
    });

    sidebarToggleBtn.addEventListener('click', () => {
      setSidebarCollapsed(!isSidebarCollapsed);
    });

    // TOC navigation via coordinate delegation (toc-list is inert for Ctrl+F exclusion)
    tocScrollWrapper.addEventListener('click', e => {
      if (isSidebarCollapsed) return;
      const links = Array.from(tocList.querySelectorAll('a'));
      for (const link of links) {
        const rect = link.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const href = link.getAttribute('href') || '';
          let heading = null;
          if (href.startsWith('#')) {
            const rawId = href.slice(1);
            const headingId = rawId.includes('%') ? decodeURIComponent(rawId) : rawId;
            heading = document.getElementById(headingId);
          }
          if (heading) {
            heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActiveTOC(link);
          }
          break;
        }
      }
    });

    tocScrollWrapper.addEventListener('mousemove', e => {
      if (isSidebarCollapsed) return;
      const links = Array.from(tocList.querySelectorAll('a'));
      links.forEach(link => link.classList.remove('toc-hover'));
      tocScrollWrapper.style.cursor = 'pointer';
      for (const link of links) {
        const rect = link.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          link.classList.add('toc-hover');
          break;
        }
      }
    });

    tocScrollWrapper.addEventListener('mouseleave', () => {
      tocScrollWrapper.style.cursor = '';
      tocList.querySelectorAll('a.toc-hover').forEach(a => a.classList.remove('toc-hover'));
    });

    let isResizing = false;
    sidebarResizer.addEventListener('mousedown', e => {
      e.preventDefault();
      isResizing = true;
    });

    document.addEventListener('mousemove', e => {
      if (!isResizing || isSidebarCollapsed || sidebar.classList.contains('hidden')) return;
      const width = Math.max(180, Math.min(420, e.clientX));
      sidebar.style.width = `${width}px`;
    });

    document.addEventListener('mouseup', () => {
      isResizing = false;
    });

    if (settingsBtn && settingsDialog) {
      settingsBtn.addEventListener('click', () => {
        loadPlantumlSettings();
        settingsDialog.showModal();
      });
    }

    if (settingsCancelBtn && settingsDialog) {
      settingsCancelBtn.addEventListener('click', () => settingsDialog.close());
    }

    if (settingsDialog && plantumlServerInput) {
      settingsDialog.addEventListener('close', () => {
        if (settingsDialog.returnValue !== 'default') return;
        const server = normalizePlantumlServer(plantumlServerInput.value);
        try { localStorage.setItem(plantumlServerStorageKey, server); } catch (e) {}
        if (currentFileText) {
          renderPlantumlBlocks();
        }
      });
    }

    window.addEventListener('beforeunload', stopFileWatch);
  }

  // ===== Init =====
  async function init() {
    setupMarkdownIt();
    loadSavedTheme();
    setupEvents();
    setSidebarCollapsed(false);
    await loadFromTransferIfPresent();
    if (window.i18n) window.i18n.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
