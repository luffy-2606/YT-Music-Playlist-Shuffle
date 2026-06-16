/**
 * YouTube Music internal API (Innertube) client.
 *
 * Reverse-engineered from YouTube Music's own network traffic.
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

// Sentinel value for no videoId
const PLACEHOLDER_SET_VIDEO_ID = 'to_be_updated_by_client';

/**
 * Fallback values used when ytcfg extraction fails.
 * The API key is the public WEB_REMIX key (it is NOT a secret)
 */
const FALLBACK = {
  API_KEY: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-KKTKVNF0A',
  CLIENT_VERSION: '1.20240101.01.00',
  CLIENT_NAME: 'WEB_REMIX',
  CLIENT_ID: '67', // :)
} as const;

const FALLBACK_CONTEXT: InnertubeContext = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.01.00',
    hl: 'en',
    gl: 'US',
    platform: 'DESKTOP',
    originalUrl: 'https://music.youtube.com/',
  },
  user: {
    lockedSafetyMode: false,
  },
  request: {
    useSsl: true,
  },
};

// delay btwn requests
const REQUEST_GAP_MS = 200;

export class YtMusicApiClient {
  private cfg: Partial<YtCfgData> = {};
  private lastRequestAt = 0;

  // Initialisation 
  async initialize(): Promise<void> {
    // Strategy 1: Read ytcfg from script tags in the DOM
    let extracted = this.tryReadYtCfgFromDom();

    // Strategy 2: postMessage injection (if DOM read didn't find the key)
    if (!extracted.INNERTUBE_API_KEY && !extracted.VISITOR_DATA) {
      try {
        extracted = await this.extractYtCfg();
      } catch (err) {
        logger.warn('Script injection approach failed', err);
      }
    }

    this.cfg = {
      INNERTUBE_CONTEXT:
        (extracted as any).INNERTUBE_CONTEXT ?? FALLBACK_CONTEXT,
      INNERTUBE_API_KEY:
        extracted.INNERTUBE_API_KEY ?? FALLBACK.API_KEY,
      INNERTUBE_CLIENT_VERSION:
        extracted.INNERTUBE_CLIENT_VERSION ?? FALLBACK.CLIENT_VERSION,
      INNERTUBE_CONTEXT_CLIENT_NAME:
        extracted.INNERTUBE_CONTEXT_CLIENT_NAME ?? FALLBACK.CLIENT_NAME,
      VISITOR_DATA: extracted.VISITOR_DATA,
    } as YtCfgData;

    if (!this.cfg.VISITOR_DATA) {
      logger.warn('visitorData not found in ytcfg -> edit_playlist calls WILL return 400. ');
    }
  }

  /* Parse ytcfg.set({...}) calls directly from <script> tags in the DOM. */
  private tryReadYtCfgFromDom(): Partial<YtCfgData> {
    try {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script')
      );
      const merged: Record<string, unknown> = {};

      for (const script of scripts) {
        const text = script.textContent ?? '';
        let searchFrom = 0;

        while (true) {
          const callStart = text.indexOf('ytcfg.set(', searchFrom);
          if (callStart === -1) break;

          const braceStart = text.indexOf('{', callStart + 10);
          if (braceStart === -1) {
            searchFrom = callStart + 10;
            break;
          }

          // Walk through characters counting bracket depth to find the
          // matching closing brace (handles nested objects correctly).
          let depth = 0;
          let braceEnd = -1;
          for (let i = braceStart; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') {
              depth--;
              if (depth === 0) {
                braceEnd = i;
                break;
              }
            }
          }

          if (braceEnd !== -1) {
            try {
              const data = JSON.parse(text.slice(braceStart, braceEnd + 1));
              Object.assign(merged, data);
            } catch {
              // Malformed JSON in this ytcfg call (skip)
            }
          }

          searchFrom =
            braceEnd !== -1 ? braceEnd + 1 : callStart + 10;
        }
      }

      return merged as Partial<YtCfgData>;
    } catch (err) {
      logger.warn('tryReadYtCfgFromDom threw unexpectedly', err);
      return {};
    }
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

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('ytcfg-bootstrap.js');
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

  // Auth / Headers

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Origin': 'https://music.youtube.com',
      'Referer': window.location.href,
      'X-Goog-AuthUser': '0',
      'X-Youtube-Client-Name': FALLBACK.CLIENT_ID,
      'X-Youtube-Client-Version':
        this.cfg.INNERTUBE_CLIENT_VERSION ??
        (this.cfg as any).INNERTUBE_CONTEXT_CLIENT_VERSION ??
        FALLBACK.CLIENT_VERSION,
    };

    // visitorData is required for edit_playlist — omitting it causes HTTP 400.
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
      logger.warn('No SAPISID cookie, is the user signed in?');
    }

    return headers;
  }

  /* Build the Innertube context object for this request */
  private buildContext(): InnertubeContext {
    const base: InnertubeContext =
      (this.cfg as any).INNERTUBE_CONTEXT ?? FALLBACK_CONTEXT;

    return {
      ...base,
      client: {
        ...base.client,
        originalUrl: window.location.href,
        ...(this.cfg.VISITOR_DATA
          ? { visitorData: this.cfg.VISITOR_DATA }
          : {}),
      },
    };
  }

  // Core request

  /**
   * POST to an Innertube endpoint with automatic retry on transient errors.
   */
  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const apiKey = this.cfg.INNERTUBE_API_KEY ?? FALLBACK.API_KEY;
    const url = `${BASE_URL}/${endpoint}?key=${apiKey}&prettyPrint=false`;

    return retry(async () => {
      // Enforce global rate limit
      const gap = Date.now() - this.lastRequestAt;
      if (gap < REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS - gap);

      const headers = await this.buildHeaders();

      const payload = {
        context: this.buildContext(),
        ...body,
      };

      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include', 
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

  // Public API methods

  /** Fetch the first page of a playlist. browseId = "VL" + playlistId */
  async browsePlaylist(playlistId: string): Promise<BrowseResponse> {
    const browseId = playlistId.startsWith('VL')
      ? playlistId
      : `VL${playlistId}`;

    return this.post<BrowseResponse>('browse', { browseId });
  }

  /** Fetch the next continuation page. */
  async browsePlaylistContinuation(
    continuation: string
  ): Promise<BrowseResponse> {
    return this.post<BrowseResponse>('browse', { continuation });
  }

  /**
   * Edit a playlist (reorder, remove, add tracks).
   *
   * @param playlistId 
   * @param actions 
   */
  async editPlaylist(
    playlistId: string,
    actions: PlaylistEditAction[]
  ): Promise<EditPlaylistResponse> {
    return this.post<EditPlaylistResponse>('browse/edit_playlist', {
      playlistId,
      actions,
    });
  }

  // Response parsing

  /* Extract PlaylistTrack array and next continuation token from a raw browse API response. */
  extractTracks(
    response: BrowseResponse,
    startIndex: number = 0
  ): { tracks: PlaylistTrack[]; continuation: string | null } {
    const tracks: PlaylistTrack[] = [];
    let continuation: string | null = null;

    // 1. COLLECT ALL POSSIBLE ITEM CONTAINERS
    const candidates: unknown[] = [];

    const pushIfExists = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      candidates.push(obj);
    };

    pushIfExists(
      response?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content
    );
    pushIfExists(response?.continuationContents);
    pushIfExists(response?.contents);
    pushIfExists(response);

    // 2. FIND ALL RENDERERS RECURSIVELY
    const items: Record<string, unknown>[] = [];

    const findResponsiveItems = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      if (obj.musicResponsiveListItemRenderer) {
        items.push(obj.musicResponsiveListItemRenderer);
      }

      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'object') {
          findResponsiveItems(val);
        }
      }
    };

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;

      if (node.musicResponsiveListItemRenderer) {
        items.push(node.musicResponsiveListItemRenderer);
      }

      if (node.musicShelfRenderer?.contents) {
        for (const c of node.musicShelfRenderer.contents) walk(c);
      }

      if (node.musicPlaylistShelfRenderer?.contents) {
        for (const c of node.musicPlaylistShelfRenderer.contents) walk(c);
      }

      if (Array.isArray(node.contents)) {
        for (const c of node.contents) walk(c);
      }

      if (Array.isArray(node.tabs)) {
        for (const t of node.tabs) walk(t);
      }

      if (Array.isArray(node.sectionListRenderer?.contents)) {
        for (const c of node.sectionListRenderer.contents) walk(c);
      }
    };

    findResponsiveItems(response);
    for (const c of candidates) walk(c);

    // 3. PARSE TRACKS
    for (let i = 0; i < items.length; i++) {
      const track = this.parseTrackItem(items[i], startIndex + i);
      if (track) tracks.push(track);
    }

    // 4. CONTINUATION TOKEN
    const findContinuation = (obj: any): string | null => {
      if (!obj || typeof obj !== 'object') return null;

      if (obj.continuation) return obj.continuation;

      if (obj.nextContinuationData?.continuation) {
        return obj.nextContinuationData.continuation;
      }

      if (obj.continuations?.[0]?.nextContinuationData?.continuation) {
        return obj.continuations[0].nextContinuationData.continuation;
      }

      for (const key of Object.keys(obj)) {
        const val = findContinuation(obj[key]);
        if (val) return val;
      }

      return null;
    };

    continuation =
      findContinuation(response.continuationContents) ||
      findContinuation(response) ||
      null;

    return { tracks, continuation };
  }

  private parseTrackItem(
    renderer: Record<string, unknown> | undefined | null,
    index: number
  ): PlaylistTrack | null {
    if (!renderer) return null;

    // ── 1. playlistItemData (preferred)
    const pid = renderer['playlistItemData'] as
      | Record<string, unknown>
      | undefined;
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
      const menuItems =
        this.deepGet<unknown[]>(renderer, [
          'menu',
          'menuRenderer',
          'items',
        ]) ?? [];

      for (const raw of menuItems) {
        const item = raw as Record<string, unknown>;
        const actions =
          this.deepGet<Array<Record<string, unknown>>>(item, [
            'menuServiceItemRenderer',
            'serviceEndpoint',
            'playlistEditEndpoint',
            'actions',
          ]) ?? [];

        for (const action of actions) {
          if (
            action['action'] === 'ACTION_REMOVE_VIDEO' &&
            action['setVideoId']
          ) {
            setVideoId = action['setVideoId'] as string;
            break;
          }
        }
        if (setVideoId) break;
      }
    }

    if (setVideoId === PLACEHOLDER_SET_VIDEO_ID) {
      logger.warn(`Track at index ${index} has placeholder setVideoId — skipping (videoId=${videoId}).`);
      return null;
    }

    if (!videoId || !setVideoId) {
      logger.debug(`Track at index ${index}: missing videoId or setVideoId`, {
        videoId,
        setVideoId,
        rendererKeys: Object.keys(renderer),
      });
      return null;
    }

    const cols =
      (renderer['flexColumns'] as Array<Record<string, unknown>> | undefined) ??
      [];

    const colText = (colIdx: number): string => {
      const runs =
        this.deepGet<Array<{ text: string }>>(cols[colIdx] ?? {}, [
          'musicResponsiveListItemFlexColumnRenderer',
          'text',
          'runs',
        ]) ?? [];
      return runs.map(r => r.text).join('') || '';
    };

    const title = colText(0) || 'Unknown Title';
    const artist = colText(1) || 'Unknown Artist';
    const duration = colText(cols.length - 1) || '';

    return { videoId, setVideoId, title, artist, duration, index };
  }

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

export const apiClient = new YtMusicApiClient();