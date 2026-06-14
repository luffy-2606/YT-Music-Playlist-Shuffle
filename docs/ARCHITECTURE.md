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
├── content/
│   └── index.ts          ← Entry point. Owns the operation lifecycle.
│
├── api/
│   ├── types.ts          ← All TypeScript interfaces for the Innertube API
│   └── ytMusicApi.ts     ← HTTP client: auth, browse, edit_playlist
│
├── playlist/
│   ├── collector.ts      ← Fetches all tracks (handles pagination)
│   └── shuffler.ts       ← Applies a new order via batched API calls
│
├── ui/
│   ├── styles.ts         ← All CSS as a TypeScript string (injected once)
│   ├── button.ts         ← Injects "True Shuffle" + "Restore" into YTM header
│   └── progressModal.ts  ← Progress modal / success / error states
│
├── storage/
│   └── backup.ts         ← chrome.storage.local CRUD for playlist backups
│
├── utils/
│   ├── logger.ts         ← Prefixed console logger
│   ├── crypto.ts         ← SHA-1 / SAPISIDHASH for YTM auth
│   ├── dom.ts            ← waitForElement, sleep, retry, cookie helpers
│   ├── navigation.ts     ← SPA route-change detector (patches History API)
│   └── shuffle.ts        ← Cryptographically-secure Fisher-Yates shuffle
│
└── popup/
    └── popup.ts          ← Popup reads backups, shows restore option
```

---

## Data Flow: Shuffle Operation

```
User clicks "True Shuffle"
         │
         ▼
content/index.ts → runShuffle(playlistId)
         │
         ├─ 1. Show ProgressModal
         │
         ├─ 2. playlist/collector.ts → collectAll(playlistId)
         │       └── api/ytMusicApi.ts → POST /browse (VL<playlistId>)
         │             ├── page 1: extract tracks + continuation token
         │             ├── page 2: POST /browse {continuation}
         │             └── … until no more continuation tokens
         │
         ├─ 3. storage/backup.ts → save(playlistId, title, tracks)
         │       └── chrome.storage.local.set(...)
         │
         ├─ 4. utils/shuffle.ts → shuffleAndVerify(tracks)
         │       └── Fisher-Yates using crypto.getRandomValues()
         │
         ├─ 5. playlist/shuffler.ts → applyOrder(playlistId, shuffled)
         │       ├── Generate n-1 ACTION_MOVE_VIDEO_BEFORE actions
         │       │     (right-to-left: move T[i-1] before T[i])
         │       └── Batch into groups of 30
         │             └── api/ytMusicApi.ts → POST /browse/edit_playlist
         │                   ├── batch 1 (30 actions)
         │                   ├── … 600ms delay …
         │                   └── batch N
         │
         └─ 6. ProgressModal.showSuccess() / showError()
```

---

## SPA Navigation Handling

YouTube Music never does a full page reload. All routing is via the History API.

`NavigationDetector` patches `history.pushState` and `history.replaceState` and
listens for `popstate`. It also polls the URL every 750ms as a safety net.

On each navigation, `content/index.ts` calls `handleRouteChange()`:
- If on a `/playlist?list=` URL → inject buttons (if not already present)
- If navigated away → call `buttonInjector.destroy()`

The `ButtonInjector` additionally runs a `MutationObserver` on the header
element to re-attach the buttons if YouTube Music's own re-renders remove them.

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
| 5000-track playlist | ~6–8 minutes (MAX_TRACKS cap at 5000) |

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
    trackCount:    number,
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
