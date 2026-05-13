// ==UserScript==
// @name         SaveTabs — Save Open Tabs to HTML
// @namespace    https://github.com/noimg
// @version      1.6.0
// @description  Saves all open tabs to a beautiful HTML page. Hotkey: Ctrl+Shift+M
// @author       Konstantin Batischev
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
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

    // ── Per-tab identity ──────────────────────────────────────────────────────
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
        reg.push({ id: myId, url: location.href, title: document.title || location.hostname, ts: now });
        GM_setValue(KEY_REGISTRY, JSON.stringify(reg));
    }

    registerSelf();
    setInterval(registerSelf, 30000);

    // ── Close signaling ───────────────────────────────────────────────────────
    const startedAt = Date.now();

    GM_addValueChangeListener(KEY_CLOSE, (_, __, newVal, remote) => {
        if (remote && typeof newVal === 'number' && newVal > startedAt) {
            window.close();
        }
    });

    // ── Keyboard shortcut: Ctrl+Shift+M ──────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.key === 'M' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey) {
            e.preventDefault();
            doSaveTabs();
        }
    });

    // ── Menu commands ─────────────────────────────────────────────────────────
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

        // Expose GM action handlers on the real page window so the viewer tab
        // can call them directly via window.opener._st (same-origin, no postMessage).
        unsafeWindow._st = {
            closeAll() {
                GM_setValue(KEY_CLOSE, Date.now());
                setTimeout(() => window.close(), 350);
            },
            deleteSess(date) {
                updateSessions(ss => ss.filter(s => s.date !== date));
            },
            deleteTab(date, url) {
                updateSessions(ss => {
                    const s = ss.find(s => s.date === date);
                    if (s) {
                        s.tabs = s.tabs.filter(t => t.url !== url);
                        if (!s.tabs.length) return ss.filter(s => s.date !== date);
                    }
                    return ss;
                });
            },
            download() {
                let ss;
                try { ss = JSON.parse(GM_getValue(KEY_SESSIONS, '[]')); } catch (_) { ss = []; }
                downloadFile(buildHTML(ss));
            },
        };

        // about:blank is always same-origin with opener, so window.opener._st works.
        const w = window.open('', '_blank');
        if (!w) {
            // Popup blocked — clean up and bail
            delete unsafeWindow._st;
            alert('SaveTabs: браузер заблокировал открытие вкладки. Разрешите всплывающие окна для этого сайта.');
            return;
        }
        w.document.write(buildViewerHTML(sessions));
        w.document.close();
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

    // ── Helpers ───────────────────────────────────────────────────────────────
    function updateSessions(fn) {
        let ss;
        try { ss = JSON.parse(GM_getValue(KEY_SESSIONS, '[]')); } catch (_) { ss = []; }
        GM_setValue(KEY_SESSIONS, JSON.stringify(fn(ss)));
    }

    function downloadFile(html) {
        const fn   = GM_getValue(KEY_FILENAME, 'saved-tabs.html');
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = fn;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Shared session list markup ────────────────────────────────────────────
    function buildSessionsMarkup(sessions) {
        return sessions.map((sess, si) => {
            const d         = new Date(sess.date);
            const dateLabel = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const timeLabel = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

            const tabsMarkup = sess.tabs.map(tab => {
                let host = '';
                try { host = new URL(tab.url).hostname; } catch (_) {}
                const fav = host
                    ? `<img class="fav" src="https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}" width="16" height="16" loading="lazy" onerror="this.style.display='none'" alt="">`
                    : `<span class="fav-ph"></span>`;
                return `
        <li>
          <a href="${esc(tab.url)}" target="_blank" rel="noopener noreferrer">
            ${fav}
            <span class="t-body">
              <span class="t-title">${esc(tab.title || tab.url)}</span>
              <span class="t-url">${esc(tab.url)}</span>
            </span>
            <span class="t-arrow">↗</span>
          </a>
          <button class="tab-del" data-date="${esc(sess.date)}" data-url="${esc(tab.url)}" title="Удалить">✕</button>
        </li>`;
            }).join('');

            return `
      <section class="sess${si === 0 ? ' sess--new' : ''}">
        <div class="sess-hd">
          <div class="sess-dt">
            <span class="sess-day">${esc(dateLabel)}</span>
            <span class="sess-time">${esc(timeLabel)}</span>
          </div>
          <span class="sess-cnt">${sess.tabs.length}&nbsp;вкладок</span>
          <button class="sess-del" data-date="${esc(sess.date)}" title="Удалить сессию">✕</button>
        </div>
        <ul class="tab-ul">${tabsMarkup}
        </ul>
      </section>`;
        }).join('');
    }

    // ── Interactive viewer (opens in new tab, uses window.opener._st) ─────────
    function buildViewerHTML(sessions) {
        const totalTabs   = sessions.reduce((n, s) => n + s.tabs.length, 0);
        const latestCount = sessions[0] ? sessions[0].tabs.length : 0;

        return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вкладки</title>
${sharedCSS()}
</head>
<body>

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

<header class="hdr">
  <div class="hdr-in">
    <div>
      <div class="hdr-logo">Сохранённые вкладки</div>
      <div class="hdr-meta">${sessions.length} сессий · ${totalTabs} вкладок</div>
    </div>
    <button id="btn-dl" class="btn-dl">⬇ Скачать HTML</button>
  </div>
</header>

<main class="main">
${buildSessionsMarkup(sessions)}
</main>

<script>
(function () {
  var st = window.opener && window.opener._st;

  if (!st) {
    document.getElementById('modal-ov').classList.add('hidden');
    document.getElementById('btn-dl').style.display = 'none';
    document.querySelectorAll('.sess-del,.tab-del').forEach(function (b) { b.style.display = 'none'; });
    return;
  }

  document.getElementById('btn-yes').onclick = function () {
    st.closeAll();
    document.getElementById('modal-ov').classList.add('hidden');
  };
  document.getElementById('btn-no').onclick = function () {
    document.getElementById('modal-ov').classList.add('hidden');
  };
  document.getElementById('btn-dl').onclick = function () {
    st.download();
  };

  document.querySelector('.main').addEventListener('click', function (ev) {
    var sb = ev.target.closest('.sess-del');
    if (sb) {
      if (!confirm('Удалить сессию?')) return;
      st.deleteSess(sb.dataset.date);
      sb.closest('.sess').remove();
      return;
    }
    var tb = ev.target.closest('.tab-del');
    if (tb) {
      st.deleteTab(tb.dataset.date, tb.dataset.url);
      var li = tb.closest('li');
      var ul = li.closest('ul');
      li.remove();
      if (!ul.querySelector('li')) ul.closest('.sess').remove();
    }
  });
}());
<\/script>
</body>
</html>`;
    }

    // ── Static HTML for download (no buttons, just links) ────────────────────
    function buildHTML(sessions) {
        const totalTabs = sessions.reduce((n, s) => n + s.tabs.length, 0);

        return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вкладки</title>
${sharedCSS()}
</head>
<body>
<header class="hdr">
  <div class="hdr-in">
    <div>
      <div class="hdr-logo">Сохранённые вкладки</div>
      <div class="hdr-meta">${sessions.length} сессий · ${totalTabs} вкладок</div>
    </div>
  </div>
</header>
<main class="main">
${buildSessionsMarkup(sessions)}
</main>
</body>
</html>`;
    }

    // ── Shared CSS ────────────────────────────────────────────────────────────
    function sharedCSS() {
        return `<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0f18;--surface:#161929;--border:#252840;
  --accent:#6366f1;--accent-h:#4f46e5;
  --text:#e2e8f0;--muted:#8892aa;--link:#818cf8;
  --radius:12px;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
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
.btn{padding:11px 26px;border-radius:8px;border:none;font-size:15px;font-weight:600;
  cursor:pointer;transition:opacity .15s,transform .1s,background .15s}
.btn:active{transform:scale(.97)}
.btn-yes{background:var(--accent);color:#fff}
.btn-yes:hover{background:var(--accent-h)}
.btn-no{background:transparent;color:var(--muted);border:1px solid var(--border)}
.btn-no:hover{color:var(--text);border-color:var(--muted)}
.hdr{background:var(--surface);border-bottom:1px solid var(--border);
  padding:18px 0;position:sticky;top:0;z-index:100}
.hdr-in{max-width:880px;margin:0 auto;padding:0 24px;
  display:flex;align-items:center;justify-content:space-between;gap:16px}
.hdr-logo{font-size:20px;font-weight:700;letter-spacing:-.3px}
.hdr-meta{font-size:13px;color:var(--muted);margin-top:3px}
.btn-dl{flex-shrink:0;padding:8px 18px;border-radius:8px;border:1px solid var(--border);
  background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;
  white-space:nowrap;transition:color .15s,border-color .15s}
.btn-dl:hover{color:var(--text);border-color:var(--muted)}
.main{max-width:880px;margin:32px auto 80px;padding:0 24px}
.sess{background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);margin-bottom:20px;overflow:hidden}
.sess--new{border-color:var(--accent)}
.sess-hd{display:flex;align-items:center;gap:12px;
  padding:16px 22px;border-bottom:1px solid var(--border)}
.sess-dt{display:flex;flex-direction:column;flex:1;min-width:0}
.sess-day{font-size:15px;font-weight:600;text-transform:capitalize}
.sess-time{font-size:13px;color:var(--muted);margin-top:2px}
.sess-cnt{font-size:12px;font-weight:600;color:var(--accent);
  background:rgba(99,102,241,.12);padding:4px 12px;border-radius:20px;white-space:nowrap}
.sess-del{flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--muted);
  font-size:16px;padding:4px 8px;border-radius:6px;line-height:1;
  transition:color .15s,background .15s}
.sess-del:hover{color:var(--text);background:rgba(255,255,255,.06)}
.tab-ul{list-style:none}
.tab-ul li{display:flex;align-items:center;border-bottom:1px solid var(--border)}
.tab-ul li:last-child{border-bottom:none}
.tab-ul a{display:flex;align-items:center;gap:12px;padding:12px 22px;flex:1;min-width:0;
  color:inherit;text-decoration:none;transition:background .12s}
.tab-ul a:hover{background:rgba(255,255,255,.04)}
.tab-ul a:hover .t-title{color:var(--link)}
.fav{flex-shrink:0;border-radius:3px}
.fav-ph{flex-shrink:0;width:16px;height:16px;border-radius:3px;background:var(--border)}
.t-body{display:flex;flex-direction:column;flex:1;min-width:0}
.t-title{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-url{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;margin-top:2px}
.t-arrow{flex-shrink:0;color:var(--muted);font-size:14px;opacity:0;transition:opacity .12s}
.tab-ul a:hover .t-arrow{opacity:1}
.tab-del{flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--muted);
  font-size:13px;padding:4px 14px 4px 6px;line-height:1;
  opacity:0;transition:color .15s,opacity .15s}
.tab-ul li:hover .tab-del{opacity:1}
.tab-del:hover{color:var(--text)}
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes slidein{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}
@media(max-width:600px){
  .modal-card{padding:28px 22px}
  .hdr-in{flex-direction:column;align-items:flex-start}
}
</style>`;
    }

})();
