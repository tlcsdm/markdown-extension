// Markdown Viewer - Main Script
(function () {
  'use strict';

  // ===== State =====
  let currentFileText = null;
  let currentFileName = null;
  let fileHistory = [];
  let themeMode = 'auto';
  let plantumlServer = 'https://kroki.io';

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
  // Encodes PlantUML text to URL-safe format using deflate + base64 variant
  const plantumlAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

  function encode6bit(b) {
    return plantumlAlphabet[b & 63];
  }

  function append3bytes(b1, b2, b3) {
    const c1 = b1 >> 2;
    const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
    const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
    const c4 = b3 & 0x3f;
    return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
  }

  function encodePlantuml(text) {
    // UTF-8 encode
    const utf8 = unescape(encodeURIComponent(text));
    const bytes = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) {
      bytes[i] = utf8.charCodeAt(i);
    }

    // Deflate using pako
    const compressed = window.pako ? window.pako.deflateRaw(bytes) : bytes;

    // Base64 encode with PlantUML alphabet
    let result = '';
    const len = compressed.length;
    for (let i = 0; i < len; i += 3) {
      if (i + 2 < len) {
        result += append3bytes(compressed[i], compressed[i + 1], compressed[i + 2]);
      } else if (i + 1 < len) {
        result += append3bytes(compressed[i], compressed[i + 1], 0);
      } else {
        result += append3bytes(compressed[i], 0, 0);
      }
    }
    return result;
  }

  // ===== Mermaid Initialization =====
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
      console.warn('Mermaid initialization failed:', e);
    }
  }

  // ===== Markdown Rendering =====
  function setupMarked() {
    if (typeof marked === 'undefined') return;

    // Custom renderer for enhanced features
    const renderer = new marked.Renderer();

    // Override heading to add IDs for anchor links
    renderer.heading = function (token) {
      const { text, depth } = token;
      const id = slugify(text);
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    };

    // Override link to handle local .md files
    renderer.link = function (token) {
      const { href, title, text } = token;
      if (href && href.endsWith('.md') && !href.startsWith('http')) {
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        return `<a href="${escapeAttr(href)}"${titleAttr} class="local-md-link" data-md-link="${escapeAttr(href)}">${text}</a>`;
      }
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      const target = href && href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${escapeAttr(href || '')}"${titleAttr}${target}>${text}</a>`;
    };

    // Override code block for Mermaid and PlantUML
    renderer.code = function (token) {
      const { text, lang } = token;
      const language = (lang || '').toLowerCase().trim();

      if (language === 'mermaid') {
        return `<div class="mermaid-block" data-mermaid="${escapeAttr(text)}">
          <div class="loading-spinner"></div>
        </div>`;
      }

      if (language === 'plantuml' || language === 'puml') {
        return `<div class="plantuml-block" data-plantuml="${escapeAttr(text)}">
          <div class="loading-spinner"></div>
        </div>`;
      }

      // Regular code block with syntax highlighting
      if (language && typeof hljs !== 'undefined') {
        try {
          const validLang = hljs.getLanguage(language) ? language : null;
          const highlighted = validLang
            ? hljs.highlight(text, { language: validLang }).value
            : hljs.highlightAuto(text).value;
          return `<pre><code class="hljs language-${escapeAttr(language)}">${highlighted}</code></pre>`;
        } catch (e) {
          // fall through to default
        }
      }

      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<pre><code class="hljs">${escaped}</code></pre>`;
    };

    marked.use({ renderer });
    marked.setOptions({ breaks: true, gfm: true });
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\u00C0-\u024F\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function escapeAttr(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

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
        block.innerHTML = `<pre class="plantuml-error">Mermaid error: ${escapeAttr(String(e.message || e))}</pre>`;
      }
    }
  }

  async function renderPlantumlBlocks() {
    const blocks = markdownBody.querySelectorAll('.plantuml-block[data-plantuml]');
    for (const block of blocks) {
      const code = block.getAttribute('data-plantuml');
      try {
        // Use kroki.io for PlantUML rendering
        const server = (localStorage.getItem('mdViewer_plantumlServer') || plantumlServer).replace(/\/$/, '');
        let imgUrl;

        if (server.includes('kroki.io')) {
          // Kroki: base64-encoded POST-style URL
          const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(code)));
          const urlSafe = encoded.replace(/\+/g, '-').replace(/\//g, '_');
          imgUrl = `${server}/plantuml/svg/${urlSafe}`;
        } else {
          // plantuml.com style: deflate + plantuml base64
          const encoded = encodePlantuml(code);
          imgUrl = `${server}/svg/${encoded}`;
        }

        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = 'PlantUML diagram';
        img.style.maxWidth = '100%';
        block.innerHTML = '';
        block.appendChild(img);
      } catch (e) {
        block.innerHTML = `<div class="plantuml-error">PlantUML error: ${escapeAttr(String(e.message || e))}</div>`;
      }
    }
  }

  // ===== TOC Generation =====
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
      a.addEventListener('click', (e) => {
        e.preventDefault();
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveTOC(a);
      });

      li.appendChild(a);
      tocList.appendChild(li);
    });

    // Intersection observer for active heading
    setupScrollSpy(headings);
  }

  function setActiveTOC(activeLink) {
    tocList.querySelectorAll('a').forEach(a => a.classList.remove('active'));
    if (activeLink) activeLink.classList.add('active');
  }

  function setupScrollSpy(headings) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            const link = tocList.querySelector(`a[href="#${id}"]`);
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
      const html = marked.parse(text);
      markdownBody.innerHTML = html;
    } catch (e) {
      markdownBody.innerHTML = `<div class="plantuml-error">Render error: ${escapeAttr(String(e.message || e))}</div>`;
      return;
    }

    buildTOC();
    contentArea.scrollTop = 0;

    // Render diagrams
    initMermaid();
    await renderMermaidBlocks();
    await renderPlantumlBlocks();

    // Handle local markdown links
    setupLocalLinks();
  }

  function setupLocalLinks() {
    markdownBody.querySelectorAll('a.local-md-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const mdPath = a.getAttribute('data-md-link');
        promptOpenLinkedFile(mdPath);
      });
    });
  }

  function promptOpenLinkedFile(mdPath) {
    // Store the path hint and trigger file picker
    linkedFileInput.setAttribute('data-hint', mdPath);
    linkedFileInput.click();
  }

  function loadFile(file) {
    if (!file.name.match(/\.(md|markdown)$/i)) {
      const msg = window.i18n ? window.i18n.getMessage('invalidFileType') : 'Please drop a .md or .markdown file';
      alert(msg);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      loadMarkdownText(e.target.result, file.name);
    };
    reader.onerror = () => {
      const msg = window.i18n ? window.i18n.getMessage('fileReadFailed') : 'Failed to read file';
      alert(msg);
    };
    reader.readAsText(file);
  }

  // ===== History Navigation =====
  function pushHistory(text, filename) {
    if (currentFileText) {
      fileHistory.push({ text: currentFileText, filename: currentFileName });
      backBtn.style.display = '';
    }
  }

  function navigateBack() {
    if (fileHistory.length === 0) return;
    const prev = fileHistory.pop();
    if (fileHistory.length === 0) {
      backBtn.style.display = 'none';
    }
    loadMarkdownText(prev.text, prev.filename);
  }

  // ===== Theme Management =====
  function applyTheme(mode) {
    themeMode = mode;
    let theme = 'light';
    if (mode === 'dark') {
      theme = 'dark';
    } else if (mode === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.documentElement.setAttribute('data-theme', theme);

    // Toggle highlight.js themes
    const lightTheme = document.getElementById('hljs-light-theme');
    const darkTheme = document.getElementById('hljs-dark-theme');
    if (lightTheme && darkTheme) {
      lightTheme.disabled = theme === 'dark';
      darkTheme.disabled = theme !== 'dark';
    }

    // Update button states
    ['light', 'dark', 'auto'].forEach(m => {
      const btn = document.getElementById(`theme-${m}-btn`);
      if (btn) btn.classList.toggle('active', m === mode);
    });

    try {
      localStorage.setItem('mdViewer_themeMode', mode);
    } catch (e) {}

    // Re-render mermaid diagrams if loaded
    if (currentFileText) {
      initMermaid();
      renderMermaidBlocks();
    }
  }

  function loadSavedTheme() {
    try {
      const saved = localStorage.getItem('mdViewer_themeMode') || 'auto';
      applyTheme(saved);
    } catch (e) {
      applyTheme('auto');
    }
  }

  // ===== Event Listeners =====
  function setupEvents() {
    // File open button
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        pushHistory();
        loadFile(file);
        e.target.value = '';
      }
    });

    // Linked file input
    linkedFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        pushHistory();
        loadFile(file);
        e.target.value = '';
      }
    });

    // Drop zone click
    dropZone.addEventListener('click', () => {
      fileInput.click();
    });

    // Drag and drop
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) {
        dropZone.classList.remove('drag-over');
      }
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        pushHistory();
        loadFile(file);
      }
    });

    // Theme buttons
    document.getElementById('theme-light-btn').addEventListener('click', () => applyTheme('light'));
    document.getElementById('theme-dark-btn').addEventListener('click', () => applyTheme('dark'));
    document.getElementById('theme-auto-btn').addEventListener('click', () => applyTheme('auto'));

    // Back button
    backBtn.addEventListener('click', navigateBack);

    // System theme change
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeMode === 'auto') {
        applyTheme('auto');
      }
    });
  }

  // ===== Initialization =====
  function init() {
    setupMarked();
    loadSavedTheme();
    setupEvents();

    // Apply i18n after init
    if (window.i18n) {
      window.i18n.init();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
