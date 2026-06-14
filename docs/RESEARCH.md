# Research: YouTube Music Playlist Reordering

This document records the findings from investigating how YouTube Music performs
playlist reordering, and how we replicate it in this extension.

---

## How YouTube Music Works Internally

YouTube Music is a single-page application (SPA) built on the same **Innertube**
API that powers the main YouTube site. Innertube is Google's internal RPC
framework — every action in the UI (loading a page, playing a track, editing a
playlist) corresponds to a JSON `POST` to a `/youtubei/v1/…` endpoint.

---

## Endpoint Used: `browse/edit_playlist`

All playlist mutations (add, remove, **reorder**) go through a single endpoint:

```
POST https://music.youtube.com/youtubei/v1/browse/edit_playlist
     ?key=<INNERTUBE_API_KEY>&prettyPrint=false
```

### Request Body

```json
{
  "context": {
    "client": {
      "clientName": "WEB_REMIX",
      "clientVersion": "1.20240101.01.00",
      "hl": "en",
      "gl": "US",
      "visitorData": "...",
      "originalUrl": "https://music.youtube.com/playlist?list=PL..."
    },
    "user": { "lockedSafetyMode": false },
    "request": { "useSsl": true }
  },
  "playlistId": "PLxxxxxxxxxx",
  "actions": [ /* array of edit actions */ ]
}
```

### How We Found This

1. Open YouTube Music in Chrome.
2. Open DevTools → Network tab → filter by `edit_playlist`.
3. Right-click any track → "Save to playlist" or drag it to a new position.
4. Inspect the resulting network request.

---

## The `ACTION_MOVE_VIDEO_BEFORE` Action

To **reorder** tracks, YouTube Music sends one or more `ACTION_MOVE_VIDEO_BEFORE`
actions. Each action moves a single track to be immediately before another track:

```json
{
  "action": "ACTION_MOVE_VIDEO_BEFORE",
  "setVideoId": "<setVideoId of the track to move>",
  "movedSetVideoIdSuccessor": "<setVideoId of the track that should come after>"
}
```

After this action, the track identified by `setVideoId` will appear immediately
before the track identified by `movedSetVideoIdSuccessor`.

### The `setVideoId` Field

`setVideoId` is **not** the `videoId` (e.g. `dQw4w9WgXcQ`). It is a unique
opaque identifier for a specific **occurrence** of a video inside a specific
playlist. This allows the same video to appear multiple times in a playlist —
each occurrence has its own `setVideoId`.

Example: `CAEQARoECAIQBA==` (base-64 encoded slot descriptor)

#### Where to find `setVideoId` in the API response

When fetching a playlist via `POST /youtubei/v1/browse` with
`browseId: "VL<playlistId>"`, each track item contains the `setVideoId` in
multiple places (we try them all with a priority fallback):

**Priority 1 — `playlistItemData` (most reliable):**
```
musicResponsiveListItemRenderer
  └── playlistItemData
        ├── videoId: "dQw4w9WgXcQ"
        └── playlistSetVideoId: "CAEQARoECAIQBA=="   ← setVideoId
```

**Priority 2 — Overlay watchEndpoint:**
```
musicResponsiveListItemRenderer
  └── overlay.musicItemThumbnailOverlayRenderer
        └── content.musicPlayButtonRenderer
              └── playNavigationEndpoint.watchEndpoint
                    ├── videoId: "dQw4w9WgXcQ"
                    └── playlistSetVideoId: "CAEQARoECAIQBA=="
```

**Priority 3 — Menu ACTION_REMOVE_VIDEO action:**
```
musicResponsiveListItemRenderer
  └── menu.menuRenderer.items[]
        └── menuServiceItemRenderer
              └── serviceEndpoint.playlistEditEndpoint
                    └── actions[0]
                          ├── action: "ACTION_REMOVE_VIDEO"
                          └── setVideoId: "CAEQARoECAIQBA=="
```

---

## Authentication

Authenticated requests require the `Authorization` header:

```
Authorization: SAPISIDHASH <timestamp>_<SHA1("<timestamp> <SAPISID> https://music.youtube.com")>
```

Where:
- `timestamp` = `Math.floor(Date.now() / 1000)` (Unix time in seconds)
- `SAPISID` = value of the `SAPISID` or `__Secure-3PAPISID` cookie
- `SHA1` = hex-encoded SHA-1 digest

We also send `credentials: 'include'` on every `fetch()` so the browser
automatically includes all `music.youtube.com` cookies.

Additional headers that help:
```
X-Goog-AuthUser: 0
X-Origin: https://music.youtube.com
X-Youtube-Client-Name: 67          # numeric ID for WEB_REMIX
X-Youtube-Client-Version: <from ytcfg>
```

---

## Fetching Playlist Tracks

```
POST https://music.youtube.com/youtubei/v1/browse
```

Body:
```json
{
  "context": { /* ... */ },
  "browseId": "VL<playlistId>"
}
```

Note the `VL` prefix — this is required for the browse endpoint.

### Pagination (Continuation)

Large playlists return a `continuation` token. Subsequent pages:

```json
{
  "context": { /* ... */ },
  "continuation": "<token from previous response>"
}
```

Continuation responses are at:
```
response.continuationContents.musicShelfContinuation.contents   // tracks
response.continuationContents.musicShelfContinuation.continuations[0]  // next token
```

---

## Reordering Algorithm

### Why API over DOM Drag-and-Drop?

DOM drag-and-drop automation was investigated and rejected:
- Requires pixel-perfect coordinate calculations
- Fragile to CSS changes and layout shifts
- Extremely slow for large playlists (1 drag = 1 track at a time, visually)
- Cannot batch operations
- May trigger YTM's anti-automation heuristics

The `edit_playlist` API can accept **up to ~30 actions per request**, making
it ~30× more efficient.

### The Right-to-Left Insertion Algorithm

To reorder `n` tracks, we generate `n-1` move actions and process them in
batches of 30.

**Algorithm:**
```
For i from (n-1) downto 1:
    Move T[i-1] immediately before T[i]
```

**Correctness:** After processing step `i`, the subsequence `T[i-1..n-1]` is
correctly ordered. By the time we handle step `i`, `T[i]` is already in its
final relative position. Placing `T[i-1]` before `T[i]` extends the ordered
suffix by one element. After `i=1`, `T[0..n-1]` is fully sorted.

**Cost:** `n-1` API actions, batched into `ceil((n-1)/30)` requests.

For 1000 tracks: 999 moves → 34 requests → ~20 seconds total (including delays).

---

## Limitations & Known Issues

| Limitation | Notes |
|---|---|
| Owned playlists only | YTM will return HTTP 403 for playlists you don't own |
| Auto-generated playlists | "My Mix", radios, recommendation mixes cannot be edited |
| Rate limiting | YouTube Music may throttle after many requests; we use 600ms batching delays |
| Session expiry | If the user's session expires mid-operation, the API returns 401 |
| API key rotation | The `INNERTUBE_API_KEY` occasionally changes; we fall back to a known value |
| `setVideoId` parsing | The response schema has changed in the past; we try 3 fallback paths |

---

## Alternative Approaches Considered

### YouTube Data API v3 (Official)
- Requires OAuth 2.0 (complex for an extension, requires a GCP project)
- `playlistItems` endpoint does **not** support reordering; only add/remove/list
- **Rejected**: wrong API scope + no reorder support

### DOM Mutation via `ytmusic-queue-video-renderer` drag handles
- Would work but is ~30× slower and fragile
- **Rejected** in favour of the Innertube API
- **Kept** as a documented fallback strategy in case the API changes

---

## Future: Spotify Support

Spotify exposes a first-party REST API for reordering playlist tracks:

```
PUT https://api.spotify.com/v1/playlists/{playlist_id}/tracks
Body: { "range_start": 5, "insert_before": 0, "range_length": 1 }
```

This endpoint moves a contiguous range of tracks to a new position. It requires
OAuth 2.0 with the `playlist-modify-public` or `playlist-modify-private` scope.

### Steps to add Spotify support

1. Add `https://api.spotify.com/*` to `host_permissions` in `manifest.json`.
2. Implement an OAuth 2.0 PKCE flow using `chrome.identity.launchWebAuthFlow`.
3. Create `src/api/spotifyApi.ts` implementing `collectAll(playlistId)` and
   `applyOrder(playlistId, tracks)` using the official API.
4. Create `src/playlist/spotify/` with the same `collector.ts` / `shuffler.ts`
   interface.
5. Add `https://open.spotify.com/*` to the content script `matches`.
6. Detect the host in `src/content/index.ts` and dispatch to the correct
   adapter.

The Spotify reorder API is single-call per move (it supports a `range_length`
parameter) so the operation will be significantly faster than the YTM approach.
