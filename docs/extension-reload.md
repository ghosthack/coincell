# Getting Chrome to run the extension's new code

The extension in `extension/` is loaded unpacked, straight from this folder. Changing its files does
not change what Chrome runs. This note records what was found and how coincell deals with it.

## What was found

Observed with Chrome 158 on macOS 27, with an unpacked Manifest V3 extension whose background script
is a module service worker. It has not been checked on other versions or systems.

| What was tried after the files changed | Did Chrome run the new code? |
|---|---|
| Pressing the reload arrow on `chrome://extensions` | Yes |
| The extension calling `chrome.runtime.reload()` | Yes |
| Quitting that Chrome completely and opening it again | No |
| Quitting every Chrome on the computer and opening it again | No |
| Quitting, deleting `Default/Service Worker` in that Chrome's data folder, opening it again | Yes |

So a restart is not a reload. Chrome keeps a copy of the background script in the profile
(`Service Worker/ScriptCache`) and went on running that copy, even though the version in
`manifest.json` on disk had changed. The pages of the extension (the popup) are read from disk each
time they open, which makes it easy to think the whole extension is up to date when its background
script is not.

## What coincell does about it

The extension reloads itself:

1. Every answer coincell gives to the extension's poll carries `want`: the version in
   `extension/manifest.json` on disk (`extensionOnDisk()` in `src/server.js`).
2. The extension compares `want` with the version it is running (`chrome.runtime.getManifest().version`).
   If they differ and it is not in the middle of reading a site, it calls `chrome.runtime.reload()`
   (`listen()` in `extension/background.js`).
3. It remembers which change it reloaded for, so a mismatch that a reload does not cure cannot loop.

The extension also tells coincell which version it is running, and the dashboard shows it beside
"Browser extension connected", so a stale extension is visible at a glance.

Two things follow:

- **Bump the version in `extension/manifest.json` with every change to the extension.** The version
  is the only signal; a change without a bump is not picked up.
- **The first time needs a hand.** An extension running code from before this was added does not know
  to reload itself. Press the reload arrow once, or quit Chrome and delete `Default/Service Worker`
  from that Chrome's data folder. That folder is a cache; it also holds the service workers of sites
  you visit in that profile, which are fetched again as needed.

## If the extension seems not to have updated

1. Look at the version beside "Browser extension connected" on the dashboard.
2. If it is older than `extension/manifest.json`, press the reload arrow on `chrome://extensions`.
3. If no version shows at all, the extension running is older than this mechanism: reload it by hand once.
