# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SaveTabs is a browser tool (in three flavors) that collects all open tabs and saves them as a dated HTML session archive. There is no build step, no package manager, and no test suite — all files are delivered directly to the browser.

## Three implementations

| File / Dir | Runtime | Tab discovery |
|---|---|---|
| `savetabs.user.js` | Chromium + Tampermonkey | GM storage self-registration |
| `savetabs.safari.user.js` | Safari + Userscripts app | GM storage self-registration (async) |
| `extension/` | Chrome/Edge/Safari Web Extension (MV3) | Native `chrome.tabs.query` |

### Userscript tab discovery (the non-obvious part)

Userscripts have no access to `chrome.tabs`, so every tab running the script self-registers on load in a shared JSON array (`savetabs_registry` in GM storage). Entries older than 90 s (`STALE_MS`) are pruned as dead tabs. "Save Tabs" reads this registry rather than querying the browser directly.

### GM API difference between Chromium and Safari

Tampermonkey (`savetabs.user.js`) provides **synchronous** `GM_getValue`/`GM_setValue`. The Userscripts Safari app (`savetabs.safari.user.js`) returns **Promises** from those same calls. The Safari script wraps every GM call with `await Promise.resolve(...)` to handle both behaviours safely. When porting logic between the two, this is the main adaptation needed.

### Close signaling

- **Chromium userscript:** `GM_addValueChangeListener(KEY_CLOSE, ...)` fires immediately across tabs.
- **Safari userscript:** polls `KEY_CLOSE` every 1.2 s (`POLL_MS`) because `GM_addValueChangeListener` is unavailable.
- **Extension:** `viewer.js` calls `chrome.tabs.remove(ids)` directly — no shared-storage signal needed.

## Shared data model (GM storage / chrome.storage.local)

| Key | Shape | Purpose |
|---|---|---|
| `savetabs_registry` | `[{id, url, title, ts}]` | Live tab registry for userscripts |
| `savetabs_sessions` | `[{date: ISO, tabs: [{url, title}]}]` | Session history, max 50 |
| `savetabs_close` | timestamp (ms) | Cross-tab close signal |
| `savetabs_filename` | string | User-configured download filename |

## HTML builder duplication

`buildHTML` (inline in both userscripts) and `buildStandaloneHTML` (in `extension/utils.js`) produce nearly identical output. The extension version omits the close modal (handled instead by `viewer.js`). When changing the HTML/CSS template, update all three copies.

## Extension structure

- `popup.js` — runs when the toolbar icon is clicked; queries tabs, saves a session, opens/reuses `viewer.html`
- `viewer.html` + `viewer.js` — persistent in-extension UI; renders session list, handles per-session/per-tab deletion, download, and close-all
- `utils.js` — shared `esc()` and `buildStandaloneHTML()` used by both `popup.js` and `viewer.js`

## Safari native wrapper

`SaveTabs/` is an Xcode project that wraps the extension for App Store / Safari distribution. `SafariWebExtensionHandler.swift` is boilerplate that just echoes native messages; the actual extension logic lives in `extension/`.

## Loading the extension locally

In Chrome/Edge: go to `chrome://extensions` → Enable developer mode → Load unpacked → select the `extension/` directory.

In Safari: open `SaveTabs/SaveTabs.xcodeproj` in Xcode, build and run, then enable in Safari → Settings → Extensions.
