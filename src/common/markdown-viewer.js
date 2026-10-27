// Markdown Viewer - Main Script (uses markdown-it, mirroring VSCode rendering)
(function () {
  'use strict';

  // ===== State =====
  let currentFileText = null;
  let currentFileName = null;
  let fileHistory = [];
  let themeMode = 'auto';

  // ===== DOM References =====
  const dropZone = document.getElementById('drop-zone');
  const markdownBody = document.getElementById('markdown-body');
  const sidebar = document.getElementById('sidebar');
  const tocList = document.getElementById('toc-list');
  const fileTitle = document.getElementById('file-title');
  const fileInput = document.getElementById('file-input');
  const linkedFileInput = document.getElementById('linked-file-input');
  const backBtn = document.getElementById('back-btn');
  const contentArea = document.getElementById('content-area');

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
        const server = (localStorage.getItem('mdViewer_plantumlServer') || 'https://kroki.io').replace(/\/$/, '');
        let imgUrl;
        if (server.includes('kroki.io')) {
          const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(code)));
          const urlSafe = encoded.replace(/\+/g, '-').replace(/\//g, '_');
          imgUrl = `${server}/plantuml/svg/${urlSafe}`;
        } else {
          imgUrl = `${server}/svg/${encodePlantuml(code)}`;
        }
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = 'PlantUML diagram';
        img.style.maxWidth = '100%';
        block.innerHTML = '';
        block.appendChild(img);
      } catch (e) {
        block.innerHTML = `<div class="diagram-error">${escapeHtml(String(e.message || e))}</div>`;
      }
    }
  }

  // ===== TOC =====
  function buildTOC() {
    const headings = markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    tocList.innerHTML = '';

    if (headings.length === 0) {
      sidebar.classList.add('hidden');
      return;
    }

    sidebar.classList.remove('hidden');

    headings.forEach(heading => {
      const level = parseInt(heading.tagName.slice(1));
      const id = heading.id || slugify(heading.textContent);
      if (!heading.id) heading.id = id;

      const li = document.createElement('li');
      li.className = `toc-h${level}`;
      const a = document.createElement('a');
      a.href = '#' + id;
      a.textContent = heading.textContent;
      a.addEventListener('click', e => {
        e.preventDefault();
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveTOC(a);
      });
      li.appendChild(a);
      tocList.appendChild(li);
    });

    setupScrollSpy(headings);
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
  async function loadMarkdownText(text, filename) {
    currentFileText = text;
    currentFileName = filename;

    document.title = filename || 'Markdown Viewer';
    fileTitle.textContent = filename || 'Markdown Viewer';

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
    contentArea.scrollTop = 0;

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

  function loadFile(file) {
    if (!file.name.match(/\.(md|markdown)$/i)) {
      const msg = window.i18n ? window.i18n.getMessage('invalidFileType') : 'Please drop a .md or .markdown file';
      alert(msg);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      pushHistory();
      loadMarkdownText(e.target.result, file.name);
    };
    reader.onerror = () => {
      const msg = window.i18n ? window.i18n.getMessage('fileReadFailed') : 'Failed to read file';
      alert(msg);
    };
    reader.readAsText(file);
  }

  // ===== History =====
  function pushHistory() {
    if (currentFileText) {
      fileHistory.push({ text: currentFileText, filename: currentFileName });
      backBtn.style.display = '';
    }
  }

  function navigateBack() {
    if (fileHistory.length === 0) return;
    const prev = fileHistory.pop();
    if (fileHistory.length === 0) backBtn.style.display = 'none';
    currentFileText = null;
    loadMarkdownText(prev.text, prev.filename);
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

  // ===== Events =====
  function setupEvents() {
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) { loadFile(file); e.target.value = ''; }
    });

    linkedFileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) { loadFile(file); e.target.value = ''; }
    });

    dropZone.addEventListener('click', () => fileInput.click());

    document.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', e => {
      if (!e.relatedTarget) dropZone.classList.remove('drag-over');
    });
    document.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    document.getElementById('theme-light-btn').addEventListener('click', () => applyTheme('light'));
    document.getElementById('theme-dark-btn').addEventListener('click', () => applyTheme('dark'));
    document.getElementById('theme-auto-btn').addEventListener('click', () => applyTheme('auto'));

    backBtn.addEventListener('click', navigateBack);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeMode === 'auto') applyTheme('auto');
    });
  }

  // ===== Init =====
  function init() {
    setupMarkdownIt();
    loadSavedTheme();
    setupEvents();
    if (window.i18n) window.i18n.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
