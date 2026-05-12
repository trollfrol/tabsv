// ==UserScript==
// @name         SaveTabs — Save Open Tabs to HTML
// @namespace    https://github.com/noimg
// @version      1.4.0
// @description  Saves all open tabs to a beautiful HTML page. Hotkey: Cmd+Shift+M
// @author       Konstantin Batischev
// @match        *://*/*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
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
    const POLL_MS      = 1200;

    // ── Toast (defined first — used for diagnostics from the start) ───────────
    function showToast(msg, color) {
        if (!document.body) return;
        const t = document.createElement('div');
        t.textContent = msg;
        Object.assign(t.style, {
            position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
            background: color || '#6366f1', color: '#fff', padding: '10px 18px',
            borderRadius: '8px', fontSize: '14px', fontFamily: 'system-ui,sans-serif',
            boxShadow: '0 4px 24px rgba(0,0,0,.4)', pointerEvents: 'none',
            transition: 'opacity .4s', opacity: '1',
        });
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; }, 1800);
        setTimeout(() => { if (t.parentNode) t.remove(); }, 2300);
    }

    // ── Safe GM wrappers (never throw) ────────────────────────────────────────
    function gmGet(key, def) {
        try { return GM_getValue(key, def); }
        catch (_) { return def; }
    }
    function gmSet(key, val) {
        try { GM_setValue(key, val); }
        catch (_) {}
    }

    // ── GM storage diagnostic + startup toast ─────────────────────────────────
    // Write a test value and immediately read it back to check if GM works.
    let gmWorking = false;
    try {
        GM_setValue('__st_ping__', 'ok');
        gmWorking = (GM_getValue('__st_ping__', '') === 'ok');
    } catch (_) {}

    showToast(gmWorking
        ? 'SaveTabs готов  ⌘⇧M'
        : 'SaveTabs готов  ⌘⇧M\n(GM хранилище недоступно — только текущая вкладка)');

    // ── Per-tab identity ──────────────────────────────────────────────────────
    let myId = sessionStorage.getItem('savetabs_id');
    if (!myId) {
        myId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        try { sessionStorage.setItem('savetabs_id', myId); } catch (_) {}
    }

    // ── Self-registration ─────────────────────────────────────────────────────
    function registerSelf() {
        let reg;
        try { reg = JSON.parse(gmGet(KEY_REGISTRY, '[]')); }
        catch (_) { reg = []; }

        const now = Date.now();
        reg = reg.filter(t => now - t.ts < STALE_MS && t.id !== myId);
        reg.push({
            id: myId,
            url: location.href,
            title: document.title || location.hostname,
            ts: now,
        });
        gmSet(KEY_REGISTRY, JSON.stringify(reg));
    }

    registerSelf();
    setInterval(registerSelf, 30000);

    // ── Close signaling via polling ───────────────────────────────────────────
    const startedAt = Date.now();

    setInterval(() => {
        const closeAt = Number(gmGet(KEY_CLOSE, 0));
        if (closeAt > startedAt) window.close();
    }, POLL_MS);

    window.addEventListener('message', (e) => {
        if (e.data && e.data.savetabs === 'CLOSE_ALL') {
            gmSet(KEY_CLOSE, Date.now());
            setTimeout(() => window.close(), 350);
        }
    });

    // ── Keyboard shortcut: Cmd+Shift+M ───────────────────────────────────────
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyM' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey) {
            e.preventDefault();
            doSaveTabs();
        }
    }, true);

    // ── Menu commands ─────────────────────────────────────────────────────────
    try {
        GM_registerMenuCommand('💾 Сохранить вкладки  (⌘⇧M)', doSaveTabs);
        GM_registerMenuCommand('⚙️ Имя файла', configFilename);
        GM_registerMenuCommand('🗑️ Очистить историю', clearHistory);
    } catch (_) {}

    // ── Main action ───────────────────────────────────────────────────────────
    function doSaveTabs() {
        registerSelf();

        let reg;
        try { reg = JSON.parse(gmGet(KEY_REGISTRY, '[]')); }
        catch (_) { reg = []; }

        const now  = Date.now();
        const seen = new Set();

        // Current tab is always added directly — works even if GM storage is broken
        const currentTab = { url: location.href, title: document.title || location.hostname, ts: now };
        const allEntries = [currentTab, ...reg.filter(t => now - t.ts < STALE_MS)];

        const tabs = allEntries
            .filter(t => { if (seen.has(t.url)) return false; seen.add(t.url); return true; })
            .map(({ url, title }) => ({ url, title }));

        showToast(`Сохраняю ${tabs.length} вкладок…`);

        let sessions;
        try { sessions = JSON.parse(gmGet(KEY_SESSIONS, '[]')); }
        catch (_) { sessions = []; }

        sessions.unshift({ date: new Date().toISOString(), tabs });
        if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
        gmSet(KEY_SESSIONS, JSON.stringify(sessions));

        const html     = buildHTML(sessions);
        const filename = gmGet(KEY_FILENAME, 'saved-tabs.html');

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);

        // Download
        const a = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        // Open viewer
        const viewer = window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 15000);

        if (!viewer) {
            const shouldClose = confirm(
                'Вкладки сохранены ✓\n\n' +
                'Закрыть все остальные вкладки?\n\n' +
                '(Safari заблокировал окно просмотра — разрешите в адресной строке)'
            );
            if (shouldClose) gmSet(KEY_CLOSE, Date.now());
            setTimeout(() => { location.href = url; }, 300);
        }
    }

    function configFilename() {
        const cur = gmGet(KEY_FILENAME, 'saved-tabs.html');
        const val = prompt('Имя файла для сохранения:', cur);
        if (val && val.trim()) {
            let fn = val.trim();
            if (!fn.endsWith('.html')) fn += '.html';
            gmSet(KEY_FILENAME, fn);
        }
    }

    function clearHistory() {
        if (confirm('Очистить всю историю сессий?')) {
            gmSet(KEY_SESSIONS, '[]');
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
        const generatedAt = new Date().toLocaleString('ru-RU');
        const latestCount = sessions[0] ? sessions[0].tabs.length : 0;

        const sessionsMarkup = sessions.map((sess, idx) => {
            const d         = new Date(sess.date);
            const dateLabel = d.toLocaleDateString('ru-RU', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            });
            const timeLabel = d.toLocaleTimeString('ru-RU', {
                hour: '2-digit', minute: '2-digit',
            });

            const tabsMarkup = sess.tabs.map(tab => {
                let host = '';
                try { host = new URL(tab.url).hostname; } catch (_) {}
                const fav = host
                    ? `<img class="fav" src="https://www.google.com/s2/favicons?sz=32&amp;domain=${encodeURIComponent(host)}" width="16" height="16" loading="lazy" onerror="this.style.display='none'" alt="">`
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
        </li>`;
            }).join('');

            return `
      <section class="sess${idx === 0 ? ' sess--new' : ''}">
        <div class="sess-hd">
          <div class="sess-dt">
            <span class="sess-day">${esc(dateLabel)}</span>
            <span class="sess-time">${esc(timeLabel)}</span>
          </div>
          <span class="sess-cnt">${sess.tabs.length}&nbsp;вкладок</span>
        </div>
        <ul class="tab-ul">${tabsMarkup}
        </ul>
      </section>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вкладки · ${esc(generatedAt)}</title>
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
.main{max-width:880px;margin:32px auto 80px;padding:0 24px}
.sess{background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);margin-bottom:20px;overflow:hidden}
.sess--new{border-color:var(--accent)}
.sess-hd{display:flex;align-items:center;justify-content:space-between;
  padding:16px 22px;border-bottom:1px solid var(--border);gap:12px}
.sess-dt{display:flex;flex-direction:column}
.sess-day{font-size:15px;font-weight:600;text-transform:capitalize}
.sess-time{font-size:13px;color:var(--muted);margin-top:2px}
.sess-cnt{font-size:12px;font-weight:600;color:var(--accent);
  background:rgba(99,102,241,.12);padding:4px 12px;border-radius:20px;white-space:nowrap}
.tab-ul{list-style:none}
.tab-ul li{border-bottom:1px solid var(--border)}
.tab-ul li:last-child{border-bottom:none}
.tab-ul a{display:flex;align-items:center;gap:12px;padding:12px 22px;
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
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes slidein{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}
@media(max-width:600px){
  .modal-card{padding:28px 22px}
  .sess-hd{flex-direction:column;align-items:flex-start}
  .hdr-in{flex-direction:column;align-items:flex-start}
}
</style>
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
      <div class="hdr-meta">${sessions.length} сессий · ${totalTabs} вкладок · ${esc(generatedAt)}</div>
    </div>
  </div>
</header>

<main class="main">
${sessionsMarkup}
</main>

<script>
(function () {
  var ov = document.getElementById('modal-ov');
  if (!window.opener) { ov.classList.add('hidden'); return; }
  document.getElementById('btn-yes').addEventListener('click', function () {
    try { window.opener.postMessage({ savetabs: 'CLOSE_ALL' }, '*'); } catch (e) {}
    ov.classList.add('hidden');
  });
  document.getElementById('btn-no').addEventListener('click', function () {
    ov.classList.add('hidden');
  });
}());
<\/script>
</body>
</html>`;
    }

})();
