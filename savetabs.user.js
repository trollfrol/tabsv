// ==UserScript==
// @name         SaveTabs — Save Open Tabs to HTML
// @namespace    https://github.com/noimg
// @version      1.3.0
// @description  Saves all open tabs to a beautiful HTML page. Hotkey: Ctrl+Shift+M
// @author       Konstantin Batischev
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        window.close
// ==/UserScript==

(function () {
    'use strict';

    // ── Constants ─────────────────────────────────────────────────────────────
    const KEY_REGISTRY = 'savetabs_registry';
    const KEY_SESSIONS = 'savetabs_sessions';
    const KEY_CLOSE    = 'savetabs_close';
    const KEY_FILENAME = 'savetabs_filename';
    const STALE_MS     = 90000;
    const MAX_SESSIONS = 50;

    // ── Per-tab identity (stable for the lifetime of this tab) ────────────────
    let myId = sessionStorage.getItem('savetabs_id');
    if (!myId) {
        myId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        sessionStorage.setItem('savetabs_id', myId);
    }

    // ── Self-registration ─────────────────────────────────────────────────────
    function registerSelf() {
        let reg;
        try { reg = JSON.parse(GM_getValue(KEY_REGISTRY, '[]')); }
        catch (_) { reg = []; }

        const now = Date.now();
        reg = reg.filter(t => now - t.ts < STALE_MS && t.id !== myId);
        reg.push({
            id: myId,
            url: location.href,
            title: document.title || location.hostname,
            ts: now,
        });
        GM_setValue(KEY_REGISTRY, JSON.stringify(reg));
    }

    registerSelf();
    setInterval(registerSelf, 30000);

    // ── Close + delete signaling from viewer ──────────────────────────────────
    const startedAt = Date.now();

    GM_addValueChangeListener(KEY_CLOSE, (_, __, newVal, remote) => {
        if (remote && typeof newVal === 'number' && newVal > startedAt) {
            window.close();
        }
    });

    window.addEventListener('message', (e) => {
        if (!e.data || typeof e.data.savetabs !== 'string') return;

        switch (e.data.savetabs) {
            case 'CLOSE_ALL':
                GM_setValue(KEY_CLOSE, Date.now());
                setTimeout(() => window.close(), 350);
                break;

            case 'DELETE_SESSION':
                try {
                    const sessions = JSON.parse(GM_getValue(KEY_SESSIONS, '[]'));
                    sessions.splice(e.data.idx, 1);
                    GM_setValue(KEY_SESSIONS, JSON.stringify(sessions));
                } catch (_) {}
                break;

            case 'DELETE_TAB':
                try {
                    const sessions = JSON.parse(GM_getValue(KEY_SESSIONS, '[]'));
                    const si = e.data.sessIdx, ti = e.data.tabIdx;
                    if (sessions[si]) {
                        sessions[si].tabs.splice(ti, 1);
                        if (sessions[si].tabs.length === 0) sessions.splice(si, 1);
                    }
                    GM_setValue(KEY_SESSIONS, JSON.stringify(sessions));
                } catch (_) {}
                break;
        }
    });

    // ── Keyboard shortcut: Ctrl+Shift+M ──────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.key === 'M' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey) {
            e.preventDefault();
            doSaveTabs();
        }
    });

    // ── Menu commands (Tampermonkey icon) ─────────────────────────────────────
    GM_registerMenuCommand('💾 Сохранить вкладки  (Ctrl+Shift+M)', doSaveTabs);
    GM_registerMenuCommand('⚙️ Имя файла', configFilename);
    GM_registerMenuCommand('🗑️ Очистить историю', clearHistory);

    // ── Main action ───────────────────────────────────────────────────────────
    function doSaveTabs() {
        registerSelf();

        let reg;
        try { reg = JSON.parse(GM_getValue(KEY_REGISTRY, '[]')); }
        catch (_) { reg = []; }

        const now = Date.now();
        const seen = new Set();
        const tabs = reg
            .filter(t => now - t.ts < STALE_MS)
            .filter(t => { if (seen.has(t.url)) return false; seen.add(t.url); return true; })
            .map(({ url, title }) => ({ url, title }));

        let sessions;
        try { sessions = JSON.parse(GM_getValue(KEY_SESSIONS, '[]')); }
        catch (_) { sessions = []; }

        sessions.unshift({ date: new Date().toISOString(), tabs });
        if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
        GM_setValue(KEY_SESSIONS, JSON.stringify(sessions));

        const html = buildHTML(sessions);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);

        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 15000);
    }

    function configFilename() {
        const cur = GM_getValue(KEY_FILENAME, 'saved-tabs.html');
        const val = prompt('Имя файла для сохранения:', cur);
        if (val && val.trim()) {
            let fn = val.trim();
            if (!fn.endsWith('.html')) fn += '.html';
            GM_setValue(KEY_FILENAME, fn);
        }
    }

    function clearHistory() {
        if (confirm('Очистить всю историю сессий?')) {
            GM_setValue(KEY_SESSIONS, '[]');
        }
    }

    // ── HTML builder ──────────────────────────────────────────────────────────
    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildHTML(sessions) {
        const totalTabs   = sessions.reduce((n, s) => n + s.tabs.length, 0);
        const latestCount = sessions[0] ? sessions[0].tabs.length : 0;
        const filename    = GM_getValue(KEY_FILENAME, 'saved-tabs.html');
        // Escape </script> so it can't prematurely close the viewer's script block
        const sessionsJSON = JSON.stringify(sessions).replace(/<\/script>/gi, '<\\/script>');
        const filenameJSON = JSON.stringify(filename).replace(/<\/script>/gi, '<\\/script>');

        return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вкладки</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0f18;--surface:#161929;--border:#252840;
  --accent:#6366f1;--accent-h:#4f46e5;
  --text:#e2e8f0;--muted:#8892aa;--link:#818cf8;
  --radius:12px;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}

/* ── Modal / Confirm ── */
.modal-ov{
  position:fixed;inset:0;z-index:1000;
  background:rgba(0,0,0,.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  display:flex;align-items:center;justify-content:center;
  animation:fadein .2s ease}
.modal-ov.hidden{display:none}
.modal-card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:40px 44px;
  max-width:460px;width:90%;text-align:center;
  box-shadow:0 32px 96px rgba(0,0,0,.7);
  animation:slidein .3s cubic-bezier(.16,1,.3,1)}
.modal-icon{font-size:52px;margin-bottom:18px}
.modal-title{font-size:22px;font-weight:700;letter-spacing:-.3px;margin-bottom:10px}
.modal-body{color:var(--muted);font-size:15px;margin-bottom:30px;line-height:1.6}
.modal-body strong{color:var(--text)}
.modal-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn{
  padding:11px 26px;border-radius:8px;border:none;
  font-size:15px;font-weight:600;cursor:pointer;
  transition:opacity .15s,transform .1s,background .15s}
.btn:active{transform:scale(.97)}
.btn-yes{background:var(--accent);color:#fff}
.btn-yes:hover{background:var(--accent-h)}
.btn-no{
  background:transparent;color:var(--muted);
  border:1px solid var(--border)}
.btn-no:hover{color:var(--text);border-color:var(--muted)}

/* ── Header ── */
.hdr{
  background:var(--surface);border-bottom:1px solid var(--border);
  padding:18px 0;position:sticky;top:0;z-index:100}
.hdr-in{
  max-width:880px;margin:0 auto;padding:0 24px;
  display:flex;align-items:center;justify-content:space-between;gap:16px}
.hdr-logo{font-size:20px;font-weight:700;letter-spacing:-.3px}
.hdr-meta{font-size:13px;color:var(--muted);margin-top:3px}
.btn-dl{
  flex-shrink:0;padding:8px 18px;border-radius:8px;border:1px solid var(--border);
  background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;
  white-space:nowrap;transition:color .15s,border-color .15s}
.btn-dl:hover{color:var(--text);border-color:var(--muted)}

/* ── Main ── */
.main{max-width:880px;margin:32px auto 80px;padding:0 24px}

/* ── Session ── */
.sess{
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);margin-bottom:20px;overflow:hidden}
.sess--new{border-color:var(--accent)}
.sess-hd{
  display:flex;align-items:center;gap:12px;
  padding:16px 22px;border-bottom:1px solid var(--border)}
.sess-dt{display:flex;flex-direction:column;flex:1;min-width:0}
.sess-day{font-size:15px;font-weight:600;text-transform:capitalize}
.sess-time{font-size:13px;color:var(--muted);margin-top:2px}
.sess-cnt{
  font-size:12px;font-weight:600;color:var(--accent);
  background:rgba(99,102,241,.12);padding:4px 12px;border-radius:20px;white-space:nowrap}
.sess-del{
  flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--muted);
  font-size:16px;padding:4px 6px;border-radius:6px;line-height:1;
  transition:color .15s,background .15s}
.sess-del:hover{color:var(--text);background:rgba(255,255,255,.06)}

/* ── Tab list ── */
.tab-ul{list-style:none}
.tab-ul li{display:flex;align-items:center;border-bottom:1px solid var(--border)}
.tab-ul li:last-child{border-bottom:none}
.tab-ul a{
  display:flex;align-items:center;gap:12px;padding:12px 22px;flex:1;min-width:0;
  color:inherit;text-decoration:none;transition:background .12s}
.tab-ul a:hover{background:rgba(255,255,255,.04)}
.tab-ul a:hover .t-title{color:var(--link)}
.fav{flex-shrink:0;border-radius:3px}
.fav-ph{flex-shrink:0;width:16px;height:16px;border-radius:3px;background:var(--border)}
.t-body{display:flex;flex-direction:column;flex:1;min-width:0}
.t-title{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-url{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.t-arrow{flex-shrink:0;color:var(--muted);font-size:14px;opacity:0;transition:opacity .12s}
.tab-ul a:hover .t-arrow{opacity:1}
.tab-del{
  flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--muted);
  font-size:13px;padding:4px 14px 4px 6px;line-height:1;
  opacity:0;transition:color .15s,opacity .15s}
.tab-ul li:hover .tab-del{opacity:1}
.tab-del:hover{color:var(--text)}

.empty{text-align:center;padding:80px 24px;color:var(--muted)}

@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes slidein{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}

@media(max-width:600px){
  .modal-card{padding:28px 22px}
  .sess-hd{flex-wrap:wrap}
  .hdr-in{flex-direction:column;align-items:flex-start}
}
</style>
</head>
<body>

<!-- Close modal -->
<div id="modal-ov" class="modal-ov">
  <div class="modal-card">
    <div class="modal-icon">🗂️</div>
    <h2 class="modal-title">Вкладки сохранены</h2>
    <p class="modal-body">
      Новая сессия: <strong>${latestCount} вкладок</strong>.<br>
      Всего в истории: ${totalTabs} вкладок.<br><br>
      Закрыть все исходные вкладки?
    </p>
    <div class="modal-btns">
      <button id="btn-yes" class="btn btn-yes">Да, закрыть</button>
      <button id="btn-no"  class="btn btn-no">Нет, оставить</button>
    </div>
  </div>
</div>

<!-- Confirm dialog -->
<div id="confirm-ov" class="modal-ov hidden">
  <div class="modal-card">
    <p class="modal-body" id="confirm-msg" style="margin-bottom:0"></p>
    <div class="modal-btns" style="margin-top:24px">
      <button id="confirm-yes" class="btn btn-yes">Удалить</button>
      <button id="confirm-no"  class="btn btn-no">Отмена</button>
    </div>
  </div>
</div>

<header class="hdr">
  <div class="hdr-in">
    <div>
      <div class="hdr-logo">Сохранённые вкладки</div>
      <div id="hdr-meta" class="hdr-meta"></div>
    </div>
    <button id="btn-dl" class="btn-dl">⬇ Скачать HTML</button>
  </div>
</header>

<main id="main" class="main"></main>

<script>
(function () {
  var sessions = ${sessionsJSON};
  var filename  = ${filenameJSON};

  function e(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function render() {
    var mainEl = document.getElementById('main');
    var metaEl = document.getElementById('hdr-meta');
    var total  = sessions.reduce(function(n,s){return n+s.tabs.length;},0);
    metaEl.textContent = sessions.length + ' сессий · ' + total + ' вкладок';

    if (!sessions.length) {
      mainEl.innerHTML = '<div class="empty"><p>Нет сохранённых сессий.</p></div>';
      return;
    }

    mainEl.innerHTML = sessions.map(function(sess, idx) {
      var d  = new Date(sess.date);
      var dl = d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      var tl = d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
      var tabsHTML = sess.tabs.map(function(tab, ti) {
        var host = '';
        try { host = new URL(tab.url).hostname; } catch(_) {}
        var fav = host
          ? '<img class="fav" src="https://www.google.com/s2/favicons?sz=32&domain='+encodeURIComponent(host)+'" width="16" height="16" loading="lazy" onerror="this.style.display=\'none\'" alt="">'
          : '<span class="fav-ph"></span>';
        return '<li>'+
          '<a href="'+e(tab.url)+'" target="_blank" rel="noopener noreferrer">'+
            fav+'<span class="t-body">'+
            '<span class="t-title">'+e(tab.title||tab.url)+'</span>'+
            '<span class="t-url">'+e(tab.url)+'</span></span>'+
            '<span class="t-arrow">↗</span></a>'+
          '<button class="tab-del" data-action="del-tab" data-sess="'+idx+'" data-tab="'+ti+'" title="Удалить">✕</button>'+
        '</li>';
      }).join('');
      return '<section class="sess'+(idx===0?' sess--new':'')+'">'+
        '<div class="sess-hd">'+
          '<div class="sess-dt">'+
            '<span class="sess-day">'+e(dl)+'</span>'+
            '<span class="sess-time">'+e(tl)+'</span></div>'+
          '<span class="sess-cnt">'+sess.tabs.length+'&nbsp;вкладок</span>'+
          '<button class="sess-del" data-action="del-sess" data-idx="'+idx+'" title="Удалить сессию">✕</button>'+
        '</div>'+
        '<ul class="tab-ul">'+tabsHTML+'</ul>'+
      '</section>';
    }).join('');
  }

  function showConfirm(msg) {
    return new Promise(function(resolve) {
      document.getElementById('confirm-msg').textContent = msg;
      var ov  = document.getElementById('confirm-ov');
      var yes = document.getElementById('confirm-yes');
      var no  = document.getElementById('confirm-no');
      ov.classList.remove('hidden');
      function done(r) {
        ov.classList.add('hidden');
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        resolve(r);
      }
      function onYes() { done(true); }
      function onNo()  { done(false); }
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
    });
  }

  document.getElementById('main').addEventListener('click', async function(ev) {
    var sessBtn = ev.target.closest('[data-action="del-sess"]');
    if (sessBtn) {
      var idx = parseInt(sessBtn.dataset.idx);
      if (await showConfirm('Удалить сессию ('+sessions[idx].tabs.length+' вкладок)?')) {
        sessions.splice(idx, 1);
        render();
        try { window.opener.postMessage({savetabs:'DELETE_SESSION',idx:idx},'*'); } catch(_) {}
      }
      return;
    }
    var tabBtn = ev.target.closest('[data-action="del-tab"]');
    if (tabBtn) {
      var si = parseInt(tabBtn.dataset.sess);
      var ti = parseInt(tabBtn.dataset.tab);
      sessions[si].tabs.splice(ti, 1);
      if (sessions[si].tabs.length === 0) sessions.splice(si, 1);
      render();
      try { window.opener.postMessage({savetabs:'DELETE_TAB',sessIdx:si,tabIdx:ti},'*'); } catch(_) {}
    }
  });

  document.getElementById('btn-dl').addEventListener('click', function() {
    var html = buildExportHTML(sessions);
    var blob = new Blob([html], {type:'text/html;charset=utf-8'});
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);}, 5000);
  });

  function buildExportHTML(sessions) {
    var total = sessions.reduce(function(n,s){return n+s.tabs.length;},0);
    var now   = new Date().toLocaleString('ru-RU');
    var css   = "*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}" +
      ":root{--bg:#0d0f18;--surface:#161929;--border:#252840;--accent:#6366f1;--accent-h:#4f46e5;--text:#e2e8f0;--muted:#8892aa;--link:#818cf8;--radius:12px}" +
      "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}" +
      ".hdr{background:var(--surface);border-bottom:1px solid var(--border);padding:18px 0;position:sticky;top:0;z-index:100}" +
      ".hdr-in{max-width:880px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:16px}" +
      ".hdr-logo{font-size:20px;font-weight:700;letter-spacing:-.3px}" +
      ".hdr-meta{font-size:13px;color:var(--muted);margin-top:3px}" +
      ".main{max-width:880px;margin:32px auto 80px;padding:0 24px}" +
      ".sess{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:20px;overflow:hidden}" +
      ".sess--new{border-color:var(--accent)}" +
      ".sess-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--border);gap:12px}" +
      ".sess-dt{display:flex;flex-direction:column}" +
      ".sess-day{font-size:15px;font-weight:600;text-transform:capitalize}" +
      ".sess-time{font-size:13px;color:var(--muted);margin-top:2px}" +
      ".sess-cnt{font-size:12px;font-weight:600;color:var(--accent);background:rgba(99,102,241,.12);padding:4px 12px;border-radius:20px;white-space:nowrap}" +
      ".tab-ul{list-style:none}" +
      ".tab-ul li{border-bottom:1px solid var(--border)}" +
      ".tab-ul li:last-child{border-bottom:none}" +
      ".tab-ul a{display:flex;align-items:center;gap:12px;padding:12px 22px;color:inherit;text-decoration:none;transition:background .12s}" +
      ".tab-ul a:hover{background:rgba(255,255,255,.04)}" +
      ".tab-ul a:hover .t-title{color:var(--link)}" +
      ".fav{flex-shrink:0;border-radius:3px}" +
      ".fav-ph{flex-shrink:0;width:16px;height:16px;border-radius:3px;background:var(--border)}" +
      ".t-body{display:flex;flex-direction:column;flex:1;min-width:0}" +
      ".t-title{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".t-url{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}" +
      ".t-arrow{flex-shrink:0;color:var(--muted);font-size:14px;opacity:0;transition:opacity .12s}" +
      ".tab-ul a:hover .t-arrow{opacity:1}" +
      "@media(max-width:600px){.sess-hd{flex-direction:column;align-items:flex-start}.hdr-in{flex-direction:column;align-items:flex-start}}";
    var body = sessions.map(function(sess, idx) {
      var d  = new Date(sess.date);
      var dl = d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      var tl = d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
      var tabs = sess.tabs.map(function(tab) {
        var host = '';
        try { host = new URL(tab.url).hostname; } catch(_) {}
        var fav = host
          ? '<img class="fav" src="https://www.google.com/s2/favicons?sz=32&amp;domain='+encodeURIComponent(host)+'" width="16" height="16" loading="lazy" onerror="this.style.display=\'none\'" alt="">'
          : '<span class="fav-ph"></span>';
        return '<li><a href="'+e(tab.url)+'" target="_blank" rel="noopener noreferrer">'+
          fav+'<span class="t-body">'+
          '<span class="t-title">'+e(tab.title||tab.url)+'</span>'+
          '<span class="t-url">'+e(tab.url)+'</span></span>'+
          '<span class="t-arrow">↗</span></a></li>';
      }).join('');
      return '<section class="sess'+(idx===0?' sess--new':'')+'">'+
        '<div class="sess-hd"><div class="sess-dt">'+
        '<span class="sess-day">'+e(dl)+'</span><span class="sess-time">'+e(tl)+'</span></div>'+
        '<span class="sess-cnt">'+sess.tabs.length+'&nbsp;вкладок</span></div>'+
        '<ul class="tab-ul">'+tabs+'</ul></section>';
    }).join('');
    return '<!DOCTYPE html><html lang="ru"><head>'+
      '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>Вкладки \xb7 '+e(now)+'</title>'+
      '<style>'+css+'</style></head><body>'+
      '<header class="hdr"><div class="hdr-in"><div>'+
      '<div class="hdr-logo">Сохранённые вкладки</div>'+
      '<div class="hdr-meta">'+sessions.length+' сессий \xb7 '+total+' вкладок \xb7 '+e(now)+'</div>'+
      '</div></div></header>'+
      '<main class="main">'+body+'</main></body></html>';
  }

  // ── Close modal ───────────────────────────────────────────────────────────
  (function () {
    var ov = document.getElementById('modal-ov');
    if (!window.opener) { ov.classList.add('hidden'); return; }
    document.getElementById('btn-yes').addEventListener('click', function () {
      try { window.opener.postMessage({savetabs:'CLOSE_ALL'},'*'); } catch(_) {}
      ov.classList.add('hidden');
    });
    document.getElementById('btn-no').addEventListener('click', function () {
      ov.classList.add('hidden');
    });
  }());

  render();
}());
<\/script>
</body>
</html>`;
    }

})();
