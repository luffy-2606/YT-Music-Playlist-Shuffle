/**
 * YouTube Music internal API (Innertube) client.
 *
 * Reverse-engineered from YouTube Music's own network traffic.
 * See RESEARCH.md for a detailed breakdown of how each endpoint works.
 *
 * Key endpoints used:
 *   POST /youtubei/v1/browse                 — fetch playlist tracks (+ pagination)
 *   POST /youtubei/v1/browse/edit_playlist   — reorder / remove / add tracks
 */

import { logger } from '../utils/logger';
import { generateSAPIHASH } from '../utils/crypto';
import { getSapisid, retry, sleep, safeJsonParse } from '../utils/dom';
import type {
  BrowseResponse,
  EditPlaylistResponse,
  InnertubeContext,
  PlaylistEditAction,
  PlaylistTrack,
  YtCfgData,
} from './types';

const BASE_URL = 'https://music.youtube.com/youtubei/v1';

/**
 * Fallback values used when ytcfg extraction fails.
 * The API key is the public WEB_REMIX key — it is NOT a secret.
 */
const FALLBACK = {
  API_KEY: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-KKTKVNF0A',
  CLIENT_VERSION: '1.20240101.01.00',
  CLIENT_NAME: 'WEB_REMIX',
  CLIENT_ID: '67', // Numeric ID for WEB_REMIX
} as const;

/** Minimum ms between individual API requests (≈5 req/sec). */
const REQUEST_GAP_MS = 200;

// ─────────────────────────────────────────────────────────────────────────────

export class YtMusicApiClient {
  private cfg: Partial<YtCfgData> = {};
  private lastRequestAt = 0;

  // ─── Initialisation ─────────────────────────────────────────────────────

  /**
   * Extract ytcfg from the page's main JS world via script injection.
   * Must be called after DOMContentLoaded.
   */
  async initialize(): Promise<void> {
    this.cfg = await this.extractYtCfg();
    logger.info('API client initialised', {
      apiKey: this.cfg.INNERTUBE_API_KEY
        ? `${this.cfg.INNERTUBE_API_KEY.slice(0, 8)}…`
        : '(fallback)',
      clientVersion:
        this.cfg.INNERTUBE_CLIENT_VERSION ?? this.cfg.INNERTUBE_CONTEXT_CLIENT_VERSION ?? '(fallback)',
      hasVisitorData: !!this.cfg.VISITOR_DATA,
    });
  }

  /**
   * Inject a <script> into the page's main world to read window.ytcfg,
   * then receive the data via postMessage.
   */
  private extractYtCfg(): Promise<Partial<YtCfgData>> {
    return new Promise(resolve => {
      const MSG_TYPE = '__YTMS_YTCFG__';

      const handler = (evt: MessageEvent) => {
        if (evt.source !== window) return;
        if (typeof evt.data !== 'object' || evt.data?.type !== MSG_TYPE) return;
        window.removeEventListener('message', handler);
        clearTimeout(fallbackTimer);
        resolve((evt.data.payload as Partial<YtCfgData>) ?? {});
      };

      window.addEventListener('message', handler);

      // Inline script executes in the page's main world and can read ytcfg
      const script = document.createElement('script');
      script.textContent = /* js */ `
        (function () {
          try {
            var d = window.ytcfg && window.ytcfg.data_ || {};
            window.postMessage({
              type: ${JSON.stringify(MSG_TYPE)},
              payload: {
                INNERTUBE_API_KEY: d.INNERTUBE_API_KEY,
                INNERTUBE_CLIENT_VERSION: d.INNERTUBE_CLIENT_VERSION,
                INNERTUBE_CONTEXT_CLIENT_VERSION: d.INNERTUBE_CONTEXT_CLIENT_VERSION,
                VISITOR_DATA: d.VISITOR_DATA,
                INNERTUBE_CONTEXT: d.INNERTUBE_CONTEXT,
                INNERTUBE_CONTEXT_CLIENT_NAME: d.INNERTUBE_CONTEXT_CLIENT_NAME,
              }
            }, '*');
          } catch (e) {
            window.postMessage({ type: ${JSON.stringify(MSG_TYPE)}, payload: {} }, '*');
          }
        })();
      `;
      document.documentElement.appendChild(script);
      script.remove();

      // Fallback if the postMessage never arrives
      const fallbackTimer = setTimeout(() => {
        window.removeEventListener('message', handler);
        logger.warn('ytcfg extraction timed out — using fallback config');
        resolve({});
      }, 3000);
    });
  }

  // ─── Auth / Headers ─────────────────────────────────────────────────────

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Origin': 'https://music.youtube.com',
      'X-Goog-AuthUser': '0',
      'X-Youtube-Client-Name': FALLBACK.CLIENT_ID,
      'X-Youtube-Client-Version':
        this.cfg.INNERTUBE_CLIENT_VERSION ??
        this.cfg.INNERTUBE_CONTEXT_CLIENT_VERSION ??
        FALLBACK.CLIENT_VERSION,
    };

    if (this.cfg.VISITOR_DATA) {
      headers['X-Goog-Visitor-Id'] = this.cfg.VISITOR_DATA;
    }

    const sapisid = getSapisid();
    if (sapisid) {
      try {
        headers['Authorization'] = await generateSAPIHASH(sapisid);
      } catch (err) {
        logger.warn('Failed to compute SAPISIDHASH, request may fail', err);
      }
    } else {
      logger.warn('No SAPISID cookie — is the user signed in?');
    }

    return headers;
  }

  private buildContext(): InnertubeContext {
    const existing = this.cfg.INNERTUBE_CONTEXT;
    if (existing) {
      return {
        ...existing,
        client: {
          ...existing.client,
          originalUrl: window.location.href,
        },
      };
    }

    return {
      client: {
        clientName: FALLBACK.CLIENT_NAME,
        clientVersion:
          this.cfg.INNERTUBE_CLIENT_VERSION ?? FALLBACK.CLIENT_VERSION,
        hl: 'en',
        gl: 'US',
        visitorData: this.cfg.VISITOR_DATA,
        platform: 'DESKTOP',
        originalUrl: window.location.href,
      },
      user: { lockedSafetyMode: false },
      request: { useSsl: true },
    };
  }

  // ─── Core request ────────────────────────────────────────────────────────

  private async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const apiKey =
      this.cfg.INNERTUBE_API_KEY ?? FALLBACK.API_KEY;
    const url = `${BASE_URL}/${endpoint}?key=${apiKey}&prettyPrint=false`;

    return retry(async () => {
      // Enforce global rate limit
      const gap = Date.now() - this.lastRequestAt;
      if (gap < REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS - gap);

      const headers = await this.buildHeaders();
      const payload = { context: this.buildContext(), ...body };

      logger.debug(`POST /${endpoint}`, {
        bodyKeys: Object.keys(payload).join(', '),
      });

      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include', // sends all youtube.com cookies automatically
        headers,
        body: JSON.stringify(payload),
      });

      this.lastRequestAt = Date.now();

      if (!res.ok) {
        const text = await res.text();
        const snippet = text.slice(0, 300);
        throw new Error(
          `HTTP ${res.status} ${res.statusText} from /${endpoint}: ${snippet}`
        );
      }

      const json = safeJsonParse<T>(await res.text());
      if (json === null) {
        throw new Error(`Non-JSON response from /${endpoint}`);
      }
      return json;
    }, 3, 1500);
  }

  // ─── Public API methods ──────────────────────────────────────────────────

  /** Fetch the first page of a playlist. browseId = "VL" + playlistId */
  async browsePlaylist(browseId: string): Promise<BrowseResponse> {
    logger.info(`Browsing playlist: ${browseId}`);
    return this.post<BrowseResponse>('browse', { browseId });
  }

  /** Fetch the next continuation page. */
  async browsePlaylistContinuation(continuation: string): Promise<BrowseResponse> {
    return this.post<BrowseResponse>('browse', { continuation });
  }

  /**
   * Edit a playlist (reorder, remove, add tracks).
   *
   * @param playlistId - Raw playlist ID (e.g. "PLxxx"), WITHOUT the "VL" prefix.
   * @param actions    - Array of edit actions (batched for efficiency).
   */
  async editPlaylist(
    playlistId: string,
    actions: PlaylistEditAction[]
  ): Promise<EditPlaylistResponse> {
    logger.debug(
      `editPlaylist(${playlistId}) — ${actions.length} action(s)`
    );
    return this.post<EditPlaylistResponse>('browse/edit_playlist', {
      playlistId,
      actions,
    });
  }

  // ─── Response parsing ────────────────────────────────────────────────────

  /**
   * Extract PlaylistTrack array and next continuation token from a raw
   * browse (or continuation) API response.
   */
  extractTracks(
    response: BrowseResponse,
    startIndex: number = 0
  ): { tracks: PlaylistTrack[]; continuation: string | null } {
    // Locate the musicShelf contents and continuations
    let rawItems: unknown[] = [];
    let rawContinuations: unknown[] = [];

    // ── Initial browse response
    const tabs =
      response.contents?.singleColumnBrowseResultsRenderer?.tabs;
    if (tabs) {
      const section =
        tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
      if (section) {
        for (const s of section) {
          if (s.musicShelfRenderer) {
            rawItems = s.musicShelfRenderer.contents;
            rawContinuations = s.musicShelfRenderer.continuations ?? [];
            break;
          }
        }
      }
    }

    // ── Continuation response
    const cont = response.continuationContents?.musicShelfContinuation;
    if (cont) {
      rawItems = cont.contents;
      rawContinuations = cont.continuations ?? [];
    }

    // Parse tracks
    const tracks: PlaylistTrack[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i] as Record<string, unknown>;
      const track = this.parseTrackItem(
        item['musicResponsiveListItemRenderer'] as Record<string, unknown>,
        startIndex + i
      );
      if (track) tracks.push(track);
    }

    // Extract continuation token
    let continuation: string | null = null;
    if (rawContinuations.length > 0) {
      const first = rawContinuations[0] as Record<string, unknown>;
      const nextData = first['nextContinuationData'] as Record<string, unknown> | undefined;
      const reloadData = first['reloadContinuationData'] as Record<string, unknown> | undefined;
      continuation =
        (nextData?.['continuation'] as string | undefined) ??
        (reloadData?.['continuation'] as string | undefined) ??
        null;
    }

    logger.debug(
      `Parsed ${tracks.length} tracks (start=${startIndex}), ` +
        `continuation=${continuation ? '✓' : '✗'}`
    );

    return { tracks, continuation };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Parse a single musicResponsiveListItemRenderer into a PlaylistTrack.
   *
   * setVideoId extraction priority:
   *   1. playlistItemData.playlistSetVideoId      ← most reliable
   *   2. overlay watchEndpoint.playlistSetVideoId ← common fallback
   *   3. menu ACTION_REMOVE_VIDEO action           ← last resort
   */
  private parseTrackItem(
    renderer: Record<string, unknown> | undefined | null,
    index: number
  ): PlaylistTrack | null {
    if (!renderer) return null;

    // ── 1. playlistItemData (preferred)
    const pid = renderer['playlistItemData'] as Record<string, unknown> | undefined;
    let videoId = pid?.['videoId'] as string | undefined;
    let setVideoId = pid?.['playlistSetVideoId'] as string | undefined;

    // ── 2. Overlay watchEndpoint
    if (!setVideoId) {
      const endpoint = this.deepGet<Record<string, unknown>>(renderer, [
        'overlay',
        'musicItemThumbnailOverlayRenderer',
        'content',
        'musicPlayButtonRenderer',
        'playNavigationEndpoint',
        'watchEndpoint',
      ]);
      if (endpoint) {
        videoId = videoId ?? (endpoint['videoId'] as string | undefined);
        setVideoId = endpoint['playlistSetVideoId'] as string | undefined;
      }
    }

    // ── 3. Menu ACTION_REMOVE_VIDEO
    if (!setVideoId) {
      const menuItems = this.deepGet<unknown[]>(renderer, [
        'menu',
        'menuRenderer',
        'items',
      ]) ?? [];

      for (const raw of menuItems) {
        const item = raw as Record<string, unknown>;
        const actions = this.deepGet<Array<Record<string, unknown>>>(item, [
          'menuServiceItemRenderer',
          'serviceEndpoint',
          'playlistEditEndpoint',
          'actions',
        ]) ?? [];

        for (const action of actions) {
          if (action['action'] === 'ACTION_REMOVE_VIDEO' && action['setVideoId']) {
            setVideoId = action['setVideoId'] as string;
            break;
          }
        }
        if (setVideoId) break;
      }
    }

    if (!videoId || !setVideoId) {
      logger.debug(`Track at index ${index}: missing videoId or setVideoId`, {
        videoId,
        setVideoId,
        rendererKeys: Object.keys(renderer),
      });
      return null;
    }

    // ── Text columns
    const cols = renderer['flexColumns'] as Array<Record<string, unknown>> | undefined ?? [];

    const colText = (colIdx: number): string => {
      const runs = this.deepGet<Array<{ text: string }>>(cols[colIdx] ?? {}, [
        'musicResponsiveListItemFlexColumnRenderer',
        'text',
        'runs',
      ]) ?? [];
      return runs.map(r => r.text).join('') || '';
    };

    const title = colText(0) || 'Unknown Title';
    const artist = colText(1) || 'Unknown Artist';

    // Duration is often in the last flex column
    const duration = colText(cols.length - 1) || '';

    return { videoId, setVideoId, title, artist, duration, index };
  }

  /**
   * Safely traverse a nested object path.
   * Returns undefined (typed as T | undefined) at any missing key.
   */
  private deepGet<T>(
    obj: Record<string, unknown>,
    path: string[]
  ): T | undefined {
    let cur: unknown = obj;
    for (const key of path) {
      if (cur === null || cur === undefined || typeof cur !== 'object') {
        return undefined;
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur as T | undefined;
  }
}

// Singleton used throughout the extension
export const apiClient = new YtMusicApiClient();
