# SaveTabs

Userscript that collects all open browser tabs and saves them to a beautiful HTML page
with full session history. Each run prepends a new dated session to the file.

## Files

| File | Target |
|------|--------|
| `savetabs.user.js` | Chromium browsers (Chrome, Edge, Brave, …) via Tampermonkey |

## Installation — Chromium (Tampermonkey)

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension.
2. Open the Tampermonkey dashboard → **Create a new script**.
3. Replace the default content with `savetabs.user.js`.
4. Save (`Ctrl+S` / `Cmd+S`).
5. Reload any open tabs so they register themselves.
6. Click the Tampermonkey icon → **💾 Сохранить вкладки**.

## How it works

### Tab discovery

Userscripts have no access to the browser's native tabs API (`chrome.tabs`).
Instead, every tab running the script self-registers in shared GM storage on load
and refreshes its entry every 30 seconds. "Save Tabs" reads this shared registry.

### Triggering

| Platform | How |
|---|---|
| Tampermonkey | Click icon → **💾 Сохранить вкладки** |

### What happens

1. Registry is read and deduplicated by URL.
2. A new session `{date, tabs[]}` is prepended to stored history (max 50 sessions).
3. A beautiful HTML page is generated from the full history.
4. The HTML opens in a new tab (interactive viewer with close modal).
5. The HTML is also downloaded as a file (default: `saved-tabs.html`).

### Close modal

- **"Да, закрыть"** — all registered tabs close themselves; the viewer stays open.
- **"Нет, оставить"** — modal dismissed, all tabs remain.
- Opening the `.html` file manually from disk hides the modal (no opener context).

### Menu commands

| Command | Action |
|---|---|
| 💾 Сохранить вкладки | Collect tabs, save HTML, open viewer |
| ⚙️ Имя файла | Change the download filename |
| 🗑️ Очистить историю | Wipe all stored sessions |

## Known limitations

- Tabs without the script (browser settings pages, extensions, blank tabs) are not
  registered and will not appear in the list.
- "Close all" relies on each tab voluntarily calling `window.close()`.
