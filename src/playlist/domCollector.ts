/**
 * DomCollector — the only reliable way to get setVideoId for ALL tracks.
 *
 * ─── Why the API approach fails ──────────────────────────────────────────────
 *
 * YouTube Music's /browse continuation API intentionally returns the sentinel
 * string 'to_be_updated_by_client' as playlistSetVideoId for every track
 * beyond position ~100. This sentinel appears in ALL three extraction paths:
 *   • playlistItemData.playlistSetVideoId
 *   • overlay watchEndpoint.playlistSetVideoId
 *   • menu ACTION_REMOVE_VIDEO_BY_SET_VIDEO_ID action setVideoId
 *
 * The /next (queue) endpoint has the same limitation — it only returns a
 * shallow batch and its own continuations are unreliable for full playlists.
 *
 * ─── Why the DOM approach works ─────────────────────────────────────────────
 *
 * YouTube Music resolves the 'to_be_updated_by_client' sentinel client-side
 * before it renders each ytmusic-responsive-list-item-renderer element. By the
 * time the element is in the DOM and visible, el.data.playlistItemData
 * .playlistSetVideoId contains the real token.
 *
 * Content scripts run in an ISOLATED JS world and cannot read el.data directly.
 * We inject a tiny <script> that runs in the MAIN world (same context as YTM's
 * own code), reads the resolved data from every rendered element, and sends the
 * result back via window.postMessage.
 *
 * ─── Flow ────────────────────────────────────────────────────────────────────
 *
 *   1. Auto-scroll the playlist until no new items appear (count stabilises).
 *   2. Inject main-world script → read el.data from every rendered element.
 *   3. Deduplicate by setVideoId and return the complete track list.
 */

import { logger } from '../utils/logger';
import { sleep } from '../utils/dom';
import type { PlaylistTrack } from '../api/types';

// ─── Tuning constants ────────────────────────────────────────────────────────

/** Number of scroll iterations with no new items before we stop. */
const STABLE_THRESHOLD = 4;

/** Wait time between scroll attempts (ms). Enough for YTM to render new items. */
const SCROLL_WAIT_MS = 900;

/** Hard cap on scroll loops — prevents infinite loops on broken pages. */
const MAX_SCROLL_ITERATIONS = 300;

/** Timeout for the main-world extraction postMessage round-trip (ms). */
const EXTRACT_TIMEOUT_MS = 15_000;

/** YTM's sentinel value for unresolved setVideoId. Truthy, so must be compared explicitly. */
const PLACEHOLDER = 'to_be_updated_by_client';

/** PostMessage type for the DOM extraction response. */
const DOM_MSG_TYPE = '__YTMS_DOM_TRACKS_V2__';

// ─────────────────────────────────────────────────────────────────────────────

export type DomCollectorProgressFn = (itemsLoaded: number) => void;

export class DomCollector {
  private onProgress: DomCollectorProgressFn | null = null;

  setProgressCallback(fn: DomCollectorProgressFn): void {
    this.onProgress = fn;
  }

  /**
   * Scroll the playlist page until all tracks are rendered, then extract
   * track data (including resolved setVideoId) from the DOM.
   */
  async collectAll(signal?: AbortSignal): Promise<PlaylistTrack[]> {
    logger.info('[DomCollector] Starting DOM-based collection');

    await this.scrollUntilStable(signal);

    logger.info('[DomCollector] Scroll complete — extracting track data from DOM');
    const tracks = await this.extractTracksFromDOM();

    const resolved = tracks.filter(t => t.setVideoId && t.setVideoId !== PLACEHOLDER);
    const unresolved = tracks.length - resolved.length;

    if (unresolved > 0) {
      logger.warn(
        `[DomCollector] ${unresolved}/${tracks.length} tracks still have placeholder ` +
        `setVideoId after DOM extraction — they will be excluded from the shuffle. ` +
        `These are usually unavailable/deleted tracks or podcast episodes.`
      );
    }

    logger.info(`[DomCollector] Collected ${resolved.length} tracks with valid setVideoId`);
    return resolved;
  }

  // ─── Step 1: Scroll ───────────────────────────────────────────────────────

  /**
   * Scroll every plausible container to its bottom and wait for YTM to render
   * new tracks. Stop when the rendered track count has been stable for
   * STABLE_THRESHOLD consecutive iterations.
   */
  private async scrollUntilStable(signal?: AbortSignal): Promise<void> {
    let lastCount = -1;
    let stableRuns = 0;
    let iteration = 0;

    while (stableRuns < STABLE_THRESHOLD && iteration < MAX_SCROLL_ITERATIONS) {
      if (signal?.aborted) {
        throw new DOMException('Collection cancelled by user', 'AbortError');
      }

      // Push every plausible scroll container to its maximum scroll position.
      this.pushScrollContainersToBottom();

      // Also call scrollIntoView on the LAST rendered track — this is the most
      // reliable trigger for YTM's lazy-load mechanism.
      const renderers = document.querySelectorAll(
        'ytmusic-responsive-list-item-renderer'
      );
      if (renderers.length > 0) {
        (renderers[renderers.length - 1] as HTMLElement).scrollIntoView({
          block: 'end',
          behavior: 'instant',
        });
      }

      await sleep(SCROLL_WAIT_MS);
      iteration++;

      const currentCount = document.querySelectorAll(
        'ytmusic-responsive-list-item-renderer'
      ).length;

      this.onProgress?.(currentCount);
      logger.debug(
        `[DomCollector] Scroll iter ${iteration}: ` +
          `${currentCount} items rendered (stable=${stableRuns}/${STABLE_THRESHOLD})`
      );

      if (currentCount === lastCount) {
        stableRuns++;
      } else {
        stableRuns = 0;
        lastCount = currentCount;
      }
    }

    const finalCount = document.querySelectorAll(
      'ytmusic-responsive-list-item-renderer'
    ).length;

    logger.info(
      `[DomCollector] Scroll finished: ${finalCount} items after ${iteration} iterations ` +
        `(stable threshold met=${stableRuns >= STABLE_THRESHOLD})`
    );
  }

  /**
   * Attempt to scroll every element that might be controlling the playlist
   * viewport. YTM's scroll container has changed across versions, so we try
   * all known candidates plus window itself.
   */
  private pushScrollContainersToBottom(): void {
    const SCROLL_SELECTORS = [
      'ytmusic-page-container',
      'ytmusic-app',
      '#layout',
      'ytmusic-browse-inner-container-renderer',
      'tp-yt-iron-scroll-threshold',
      '#main-panel',
    ];

    for (const selector of SCROLL_SELECTORS) {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el && el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
      }
    }

    // Always try window scroll as well.
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  }

  // ─── Step 2: Extract from DOM ─────────────────────────────────────────────

  /**
   * Inject a script into the page's MAIN JavaScript world to read el.data
   * from every rendered ytmusic-responsive-list-item-renderer.
   *
   * el.data is a plain object set by YTM's custom-element lifecycle. It
   * contains the RESOLVED renderer data — including the real playlistSetVideoId
   * that replaces the 'to_be_updated_by_client' sentinel seen in API responses.
   *
   * The result is sent back to the isolated content-script world via
   * window.postMessage.
   */
  private extractTracksFromDOM(): Promise<PlaylistTrack[]> {
    return new Promise(resolve => {
      const handler = (evt: MessageEvent) => {
        if (evt.source !== window) return;
        if (!evt.data || evt.data.type !== DOM_MSG_TYPE) return;
        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);
        resolve((evt.data.tracks as PlaylistTrack[]) ?? []);
      };

      window.addEventListener('message', handler);

      const timeoutId = setTimeout(() => {
        window.removeEventListener('message', handler);
        logger.error('[DomCollector] DOM extraction timed out — no postMessage received');
        resolve([]);
      }, EXTRACT_TIMEOUT_MS);

      // Create the script element
      const script = document.createElement('script');
      
      // Load the file from our extension package instead of using inline textContent
      script.src = chrome.runtime.getURL('injected-extractor.js');
      
      // Clean up the DOM after injection
      script.onload = () => {
        script.remove();
      };

      // Inject into the MAIN world
      document.documentElement.appendChild(script);
    });
  }
}

export const domCollector = new DomCollector();
