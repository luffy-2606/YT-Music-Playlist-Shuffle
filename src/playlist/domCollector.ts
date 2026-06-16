/**
 * DomCollector
 *   1. Auto-scroll the playlist until no new items appear.
 *   2. Inject main-world script.
 *   3. Deduplicate by setVideoId and return the complete track list.
 */

import { logger } from '../utils/logger';
import { sleep } from '../utils/dom';
import type { PlaylistTrack } from '../api/types';

// scroll iterations with no new items before we stop
const STABLE_THRESHOLD = 4;

// Wait time between scroll attempts 
const SCROLL_WAIT_MS = 900;

// Hard cap on scroll loops
const MAX_SCROLL_ITERATIONS = 300; // 30,000 songs max

// Timeout for the main-world extraction 
const EXTRACT_TIMEOUT_MS = 15_000;

// Value for unresolved setVideoId
const PLACEHOLDER = 'to_be_updated_by_client';

// PostMessage type for the DOM extraction response
const DOM_MSG_TYPE = '__YTMS_DOM_TRACKS_V2__';


export type DomCollectorProgressFn = (itemsLoaded: number) => void;

export class DomCollector {
  private onProgress: DomCollectorProgressFn | null = null;

  setProgressCallback(fn: DomCollectorProgressFn): void {
    this.onProgress = fn;
  }

  /** Scroll the playlist page until all tracks are rendered, then extract track data */
  async collectAll(signal?: AbortSignal): Promise<PlaylistTrack[]> {
    logger.info('[DomCollector] Starting DOM-based collection');

    await this.scrollUntilStable(signal);

    logger.info('[DomCollector] Scroll complete');
    const tracks = await this.extractTracksFromDOM();

    const resolved = tracks.filter(t => t.setVideoId && t.setVideoId !== PLACEHOLDER);
    const unresolved = tracks.length - resolved.length;

    logger.info(`[DomCollector] Collected ${resolved.length} tracks with valid setVideoId`);
    return resolved;
  }

  // Step 1: Scroll

  // Scroll until stable till STABLE_THRESHOLD consecutive iterations.
  private async scrollUntilStable(signal?: AbortSignal): Promise<void> {
    let lastCount = -1;
    let stableRuns = 0;
    let iteration = 0;

    while (stableRuns < STABLE_THRESHOLD && iteration < MAX_SCROLL_ITERATIONS) {
      if (signal?.aborted) {
        throw new DOMException('Collection cancelled by user', 'AbortError');
      }

      this.pushScrollContainersToBottom();

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
   * try all known candidates plus window itself.
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

    // window scroll 
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  }

  // Step 2: Extract from DOM

  /* Inject a script into the page's MAIN JavaScript world to read el.data */
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
      
      script.src = chrome.runtime.getURL('injected-extractor.js');
      
      script.onload = () => {
        script.remove();
      };

      // Inject into the MAIN world
      document.documentElement.appendChild(script);
    });
  }
}

export const domCollector = new DomCollector();
