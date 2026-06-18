# Architecture: YT Music True Shuffle

## Overview

The extension is a **Manifest V3 Chrome Extension** written in TypeScript,
bundled by esbuild into two output files:

| Output | Source | Purpose |
|---|---|---|
| `dist/content.js` | `src/content/index.ts` | Injected into YTM pages |
| `dist/popup.js`   | `src/popup/popup.ts`   | Extension popup UI |

---

## Module Map

```
src/
├── api/
│   ├── types.ts          ← All TypeScript interfaces for the Innertube API
│   └── ytMusicApi.ts     ← HTTP client: auth, browse, edit_playlist
│
├── content/
│   └── index.ts          ← Entry point. Owns the operation lifecycle.
│
├── playlist/
│   ├── collector.ts      ← Fetches all tracks (handles pagination)
│   └── domCollector.ts   ← Gets the tracks via DOM scrolling
│   └── shuffler.ts       ← Applies a new order via batched API calls
│
├── popup/
│   └── popup.ts          ← Popup reads backups, shows restore option
│
├── storage/
│   └── backup.ts         ← chrome.storage.local CRUD for playlist backups
│
├── ui/
│   ├── styles.ts         ← All CSS as a TypeScript string (injected once)
│   ├── button.ts         ← Injects "True Shuffle" + "Restore" into YTM header
│   └── progressModal.ts  ← Progress modal / success / error states
│
└── utils/
    ├── crypto.ts         ← SHA-1 / SAPISIDHASH for YTM auth
    ├── dom.ts            ← waitForElement, sleep, retry, cookie helpers
    ├── logger.ts         ← Prefixed console logger
    ├── navigation.ts     ← SPA route-change detector (patches History API)
    └── shuffle.ts        ← Cryptographically-secure Fisher-Yates shuffle

```

---

## Authentication

Content scripts run in the page's cookie context. All `fetch()` calls use
`credentials: 'include'` so cookies (session, `__Secure-3PSID`, etc.) are sent.

For endpoints that require an `Authorization` header, we compute `SAPISIDHASH`:

```
timestamp = floor(Date.now() / 1000)
hash      = SHA1("${timestamp} ${SAPISID} https://music.youtube.com")
header    = "SAPISIDHASH ${timestamp}_${hash}"
```

`SAPISID` is read from `document.cookie` (it is not HttpOnly).

The `ytcfg` config object (API key, client version, visitor data) is extracted
by injecting a tiny `<script>` element into the page's main world and receiving
the values via `window.postMessage`.

---

## Error Handling Strategy

| Layer | Mechanism |
|---|---|
| HTTP failures | `retry()` with exponential backoff (max 3 attempts, 1.5s base) |
| Empty API pages | Early exit — stops pagination if a continuation returns 0 tracks |
| Missing `setVideoId` | Track is silently skipped (logged at DEBUG level) |
| User cancellation | `AbortController` threaded through collector and shuffler |
| Auth errors | Specific error messages guide the user (sign in, ownership check) |
| Rate limiting | 600ms delay between batches; 200ms global request gap |
| DOM changes | `MutationObserver` on the header re-attaches removed buttons |
| Session timeout | Surfaces as HTTP 401 with a user-readable message |

---

## Performance

| Scenario | Estimate |
|---|---|
| 50-track playlist | ~3–5 seconds |
| 200-track playlist | ~10–15 seconds |
| 1000-track playlist | ~60–90 seconds |
| 5000-track playlist | ~6–8 minutes |

The main bottleneck is the required delay between API batches to avoid
rate-limiting. The UI shows live progress so the user is never left guessing.

Async/await is used throughout — the browser's event loop is never blocked.

---

## Storage Schema

```
chrome.storage.local:
  "ytms_backup_<playlistId>": {
    playlistId:    string,          // e.g. "PLxxx"
    playlistTitle: string,
    savedAt:       string,          // ISO-8601
    tracks: [{
      videoId:    string,           // e.g. "dQw4w9WgXcQ"
      setVideoId: string,           // e.g. "CAEQARoECAIQBA=="
      title:      string,
      artist:     string,
      duration:   string,
      index:      number            // 0-based position in original order
    }]
  }
```

Backups expire after 7 days. Expired entries are pruned on each successful
shuffle completion.

---

## Build Pipeline

```
npm install       — install esbuild + @types/chrome + typescript
npm run build     — esbuild bundles src/ → dist/
npm run dev       — esbuild in watch mode (rebuilds on file save)
npm run typecheck — tsc --noEmit (type safety check without emitting)
```

Load the extension root directory as an **unpacked extension** in Chrome
(`chrome://extensions → Developer mode → Load unpacked`).
