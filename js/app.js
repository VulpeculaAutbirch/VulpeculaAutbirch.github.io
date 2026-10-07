(function () {
  'use strict';

  const { Interpreter, PseudoError, StopSignal, KEYWORDS, BUILTINS } = window.OCRPseudo;
  const EXAMPLES = window.OCR_EXAMPLES || [];
  const $ = (id) => document.getElementById(id);

  const src = $('source');
  const hl = $('highlight');
  const gutter = $('gutter');
  const out = $('console');
  const runBtn = $('run');
  const stopBtn = $('stop');
  const statusEl = $('status');

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  // ------------------------------------------------------------ highlighting

  const KW = new Set(Array.from(KEYWORDS).concat(['endfor']));
  const FN = new Set(Object.keys(BUILTINS));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const TOKEN_RE = /(\/\/.*$)|("[^"\n]*"?|'[^'\n]*'?|“[^”\n]*”?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([^A-Za-z_\d"'“/]+|\/)/g;

  function highlightLine(line) {
    let html = '';
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(line))) {
      if (m[1]) html += '<span class="t-com">' + esc(m[1]) + '</span>';
      else if (m[2]) html += '<span class="t-str">' + esc(m[2]) + '</span>';
      else if (m[3]) html += '<span class="t-num">' + m[3] + '</span>';
      else if (m[4]) {
        const lower = m[4].toLowerCase();
        const prevDot = line[m.index - 1] === '.';
        if (!prevDot && KW.has(lower)) html += '<span class="t-kw">' + m[4] + '</span>';
        else if (!prevDot && FN.has(lower)) html += '<span class="t-fn">' + m[4] + '</span>';
        else html += esc(m[4]);
      } else html += esc(m[5]);
      if (m[0] === '') TOKEN_RE.lastIndex++;
    }
    return html;
  }

  let errorLine = null;

  function render() {
    const lines = src.value.split('\n');
    let code = '';
    let nums = '';
    for (let i = 0; i < lines.length; i++) {
      const cls = i + 1 === errorLine ? ' err' : '';
      code += '<div class="ln' + cls + '">' + (highlightLine(lines[i]) || ' ') + '</div>';
      nums += '<div class="' + cls.trim() + '">' + (i + 1) + '</div>';
    }
    hl.innerHTML = code;
    gutter.innerHTML = '<div class="gutter-inner">' + nums + '</div>';
    syncScroll();
  }

  function syncScroll() {
    hl.style.transform = 'translate(' + -src.scrollLeft + 'px,' + -src.scrollTop + 'px)';
    const inner = gutter.firstChild;
    if (inner) inner.style.transform = 'translateY(' + -src.scrollTop + 'px)';
  }

  // typing a closing keyword (endif, next, else...) dedents it to match its opener
  const CLOSER = /^(endif|endwhile|endfor|endfunction|endprocedure|endclass|endswitch|else|elseif|next|until|case|default)$/i;
  let dedenting = false;
  function autoDedent(e) {
    if (dedenting || e.inputType !== 'insertText' || !/^[A-Za-z]$/.test(e.data || '') || src.selectionStart !== src.selectionEnd) return;
    const v = src.value;
    const pos = src.selectionStart;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = v.indexOf('\n', pos) === -1 ? v.length : v.indexOf('\n', pos);
    if (pos !== lineEnd) return;
    const line = v.slice(lineStart, lineEnd);
    const indent = /^ */.exec(line)[0].length;
    if (indent < 4 || !CLOSER.test(line.trim())) return;
    let prev = lineStart - 1;
    let prevLine = '';
    while (prev > 0) {
      const ps = v.lastIndexOf('\n', prev - 1) + 1;
      prevLine = v.slice(ps, prev);
      if (prevLine.trim()) break;
      prev = ps - 1;
    }
    const prevIndent = /^ */.exec(prevLine)[0].length;
    const prevCode = prevLine.replace(/\/\/.*$/, '').trim();
    // the line above opened a block at this level -> already correct (e.g. "case" under "switch")
    if (prevIndent < indent && !/^(case|default)$/i.test(line.trim())) return;
    if (/^(case|default)$/i.test(line.trim()) && !/^(case|default)\b/i.test(prevCode) && prevIndent < indent) return;
    let remove = 4;
    if (/^endswitch$/i.test(line.trim())) {
      // line up with the nearest "switch" above
      const above = v.slice(0, lineStart).split('\n').reverse().find((l) => /^\s*switch\b/i.test(l));
      if (above !== undefined) remove = Math.max(0, indent - /^ */.exec(above)[0].length);
    }
    if (!remove) return;
    dedenting = true;
    try { replaceRange(lineStart, lineStart + remove, ''); } finally { dedenting = false; }
    src.setSelectionRange(pos - remove, pos - remove);
  }

  let saveTimer = null;
  src.addEventListener('input', (e) => {
    autoDedent(e);
    if (errorLine !== null) errorLine = null;
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set('ocr-pseudo-code', src.value), 300);
  });
  src.addEventListener('scroll', syncScroll);

  // ---------------------------------------------------------------- editing

  const INDENT = '    ';
  const OPENER = /^(if\b.*\bthen\s*$|elseif\b|else\s*$|else\s+if\b|for\b|while\b|do\s*$|switch\b|case\b.*:\s*$|default\s*:?\s*$|function\b|procedure\b|(public|private)\s+(function|procedure)\b|class\b)/i;

  function replaceRange(start, end, text) {
    src.focus();
    src.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      src.setRangeText(text, start, end, 'end');
      src.dispatchEvent(new Event('input'));
    }
  }

  function setAll(text) {
    replaceRange(0, src.value.length, text);
    src.setSelectionRange(0, 0);
    src.scrollTop = 0;
    src.scrollLeft = 0;
    syncScroll();
  }

  src.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
      return;
    }
    const v = src.value;
    const s = src.selectionStart;
    const en = src.selectionEnd;
    if (e.key === 'Tab') {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      if (!e.shiftKey && s === en) { replaceRange(s, en, INDENT); return; }
      const blockEnd = en > s && v[en - 1] === '\n' ? en - 1 : en;
      const lineEnd = v.indexOf('\n', blockEnd) === -1 ? v.length : v.indexOf('\n', blockEnd);
      const block = v.slice(lineStart, lineEnd);
      const changed = block.split('\n').map((l) => (e.shiftKey ? l.replace(/^ {1,4}/, '') : INDENT + l)).join('\n');
      replaceRange(lineStart, lineEnd, changed);
      src.setSelectionRange(lineStart, lineStart + changed.length);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && s === en) {
      e.preventDefault();
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(lineStart, s);
      let indent = /^ */.exec(line)[0];
      const code = line.replace(/\/\/.*$/, '').trim();
      if (OPENER.test(code)) indent += INDENT;
      replaceRange(s, en, '\n' + indent);
    }
  });

  function goToLine(n) {
    const lines = src.value.split('\n');
    let pos = 0;
    for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    src.focus();
    src.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
    const lh = parseFloat(getComputedStyle(src).lineHeight) || 21;
    src.scrollTop = Math.max(0, (n - 4) * lh);
    syncScroll();
  }

  // ---------------------------------------------------------------- console

  let pending = '';
  let flushQueued = false;
  let placeholder = true;
  const MAX_CHARS = 200000;

  function clearConsole() {
    out.textContent = '';
    placeholder = false;
    pending = '';
  }

  function flush() {
    flushQueued = false;
    if (!pending) return;
    if (placeholder) clearConsole();
    out.appendChild(document.createTextNode(pending));
    pending = '';
    if (out.textContent.length > MAX_CHARS) {
      while (out.firstChild && out.textContent.length > MAX_CHARS * 0.8) out.removeChild(out.firstChild);
    }
    const view = $('view-console');
    view.scrollTop = view.scrollHeight;
  }

  function write(text) {
    pending += text;
    if (!flushQueued) {
      flushQueued = true;
      requestAnimationFrame(flush);
    }
  }

  function appendNode(node) {
    flush();
    if (placeholder) clearConsole();
    out.appendChild(node);
    const view = $('view-console');
    view.scrollTop = view.scrollHeight;
  }

  function sysLine(text, cls) {
    const span = document.createElement('span');
    span.className = cls || 'sys';
    span.textContent = text;
    appendNode(span);
    return span;
  }

  let pendingInput = null;

  function readInput(prompt) {
    write(prompt);
    flush();
    setStatus('input', '等待输入…');
    showTab('console');
    return new Promise((resolve) => {
      const field = document.createElement('input');
      field.className = 'stdin';
      field.type = 'text';
      field.id = 'stdin';
      field.setAttribute('aria-label', '程序输入');
      field.autocomplete = 'off';
      const finish = (value) => {
        pendingInput = null;
        const echo = document.createElement('span');
        echo.className = 'echo';
        echo.textContent = value + '\n';
        field.replaceWith(echo);
        setStatus('running', '运行中…');
        resolve(value);
      };
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(field.value); }
      });
      pendingInput = finish;
      appendNode(field);
      field.focus({ preventScroll: true });
    });
  }

  out.addEventListener('click', () => {
    const f = $('stdin');
    if (f) f.focus();
  });

  // ------------------------------------------------------------ virtual files

  const files = (() => {
    try { return JSON.parse(store.get('ocr-pseudo-files') || '{}') || {}; } catch (e) { return {}; }
  })();
  let selectedFile = null;
  const saveFiles = () => store.set('ocr-pseudo-files', JSON.stringify(files));

  const vfs = {
    read: (name) => (Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null),
    write: (name, text) => { files[name] = text; saveFiles(); filesDirty = true; },
  };
  let filesDirty = false;

  function renderFiles() {
    filesDirty = false;
    const list = $('file-list');
    list.textContent = '';
    const names = Object.keys(files).sort();
    if (!names.length) {
      const p = document.createElement('span');
      p.className = 'empty';
      p.textContent = '还没有文件。新建一个，或运行使用 openWrite 的程序。';
      list.appendChild(p);
    }
    for (const n of names) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'file-chip';
      b.textContent = n;
      b.setAttribute('aria-pressed', String(n === selectedFile));
      b.addEventListener('click', () => { selectedFile = n; renderFiles(); });
      list.appendChild(b);
    }
    const ta = $('file-content');
    if (selectedFile !== null && !(selectedFile in files)) selectedFile = null;
    ta.disabled = selectedFile === null;
    ta.value = selectedFile === null ? '' : files[selectedFile];
    $('delete-file').disabled = selectedFile === null;
    $('delete-file').textContent = '删除';
    deleteArmed = false;
  }

  $('file-content').addEventListener('input', (e) => {
    if (selectedFile === null) return;
    files[selectedFile] = e.target.value;
    saveFiles();
  });
  $('new-file').addEventListener('click', () => {
    const field = $('new-file-name');
    const name = field.value.trim() || 'sample.txt';
    if (!(name in files)) files[name] = '';
    saveFiles();
    selectedFile = name;
    field.value = '';
    renderFiles();
    $('file-content').focus();
  });
  let deleteArmed = false;
  $('delete-file').addEventListener('click', (e) => {
    if (selectedFile === null) return;
    if (!deleteArmed) {
      deleteArmed = true;
      e.target.textContent = '确认删除 ' + selectedFile + '？';
      return;
    }
    delete files[selectedFile];
    saveFiles();
    selectedFile = null;
    renderFiles();
  });

  // -------------------------------------------------------------------- tabs

  const TABS = ['console', 'files', 'ref'];
  function showTab(name) {
    for (const t of TABS) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('view-' + t).hidden = t !== name;
    }
    if (name === 'files') renderFiles();
  }
  for (const t of TABS) $('tab-' + t).addEventListener('click', () => showTab(t));

  // ---------------------------------------------------------------- running

  let current = null;

  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
  }

  const channel = new MessageChannel();
  const waiters = [];
  channel.port1.onmessage = () => { const w = waiters.shift(); if (w) w(); };
  function yieldNow() {
    flush();
    return new Promise((r) => { waiters.push(r); channel.port2.postMessage(0); });
  }

  async function run() {
    if (current) return;
    clearConsole();
    errorLine = null;
    render();
    showTab('console');
    const interp = new Interpreter({
      io: { write, input: readInput },
      fs: vfs,
      yield: yieldNow,
    });
    current = interp;
    runBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus('running', '运行中…');
    const t0 = performance.now();
    try {
      await interp.run(src.value);
      flush();
      const ms = Math.round(performance.now() - t0);
      sysLine((out.textContent && !out.textContent.endsWith('\n') ? '\n' : '') + '— 程序结束 —');
      setStatus('done', '完成 · ' + ms + ' ms');
    } catch (e) {
      flush();
      if (e instanceof StopSignal) {
        sysLine('\n— 已停止 —');
        setStatus('idle', '已停止');
      } else if (e instanceof PseudoError) {
        showError(e);
      } else {
        sysLine('\n' + (e && e.message ? e.message : String(e)), 'error');
        setStatus('error', '出错');
      }
    } finally {
      current = null;
      runBtn.disabled = false;
      stopBtn.disabled = true;
      if (filesDirty) renderFiles();
    }
  }

  function showError(e) {
    const box = document.createElement('span');
    box.className = 'error';
    const head = document.createElement('strong');
    head.textContent = e.kind === 'Syntax error' ? '语法错误 Syntax error' : '运行错误 Runtime error';
    box.appendChild(head);
    if (e.line) {
      box.appendChild(document.createTextNode('，'));
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = '第 ' + e.line + ' 行';
      link.addEventListener('click', () => goToLine(e.line));
      box.appendChild(link);
      const lineText = src.value.split('\n')[e.line - 1];
      if (lineText !== undefined) box.appendChild(document.createTextNode('\n    ' + lineText.trim()));
    }
    box.appendChild(document.createTextNode('\n' + e.message));
    appendNode(document.createTextNode(out.textContent && !out.textContent.endsWith('\n') ? '\n' : ''));
    appendNode(box);
    errorLine = e.line || null;
    render();
    setStatus('error', e.kind === 'Syntax error' ? '语法错误' : '运行错误');
  }

  function stop() {
    if (!current) return;
    current.stop();
    if (pendingInput) pendingInput('');
  }

  runBtn.addEventListener('click', run);
  stopBtn.addEventListener('click', stop);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target !== src) { e.preventDefault(); run(); }
    if (e.key === 'Escape' && current) stop();
  });
  $('clear-console').addEventListener('click', () => { clearConsole(); if (current && pendingInput) setStatus('input', '等待输入…'); });

  // --------------------------------------------------------------- examples

  const select = $('examples');
  EXAMPLES.forEach((ex, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = ex.title;
    select.appendChild(o);
  });
  select.addEventListener('change', () => {
    const ex = EXAMPLES[+select.value];
    select.value = '';
    if (!ex) return;
    if (current) stop();
    setAll(ex.code);
    if (ex.files) for (const k of Object.keys(ex.files)) vfs.write(k, ex.files[k]);
    clearConsole();
    sysLine('已载入示例「' + ex.title + '」。按 ▶ 运行。（Ctrl+Z 可以恢复之前的代码）\n');
    setStatus('idle', '就绪');
  });

  $('clear-code').addEventListener('click', () => setAll(''));

  $('copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(src.value);
      btn.textContent = '已复制';
    } catch (err) {
      src.focus();
      src.select();
      btn.textContent = '已选中，按 Ctrl+C';
    }
    setTimeout(() => { btn.textContent = '复制代码'; }, 1600);
  });

  // share links keep the program in the URL hash (works on GitHub Pages / local files)
  const toB64 = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64 = (s) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };
  const canShare = /github\.io$|^localhost$|^127\./.test(location.hostname) || location.protocol === 'file:';
  $('share').hidden = !canShare;
  $('share').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const url = location.href.split('#')[0] + '#code=' + toB64(src.value);
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); btn.textContent = '链接已复制'; } catch (err) { btn.textContent = '链接在地址栏'; }
    setTimeout(() => { btn.textContent = '分享链接'; }, 1800);
  });

  // ------------------------------------------------------------------ start

  let initial = null;
  const m = /#code=([\w-]+)/.exec(location.hash);
  if (m) { try { initial = fromB64(m[1]); } catch (e) { initial = null; } }
  if (initial === null) initial = store.get('ocr-pseudo-code');
  if (initial === null && EXAMPLES.length) initial = EXAMPLES[0].code;
  src.value = initial || '';
  render();
})();
