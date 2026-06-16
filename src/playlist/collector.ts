/**
 * PlaylistCollector — orchestrates full playlist track collection.
 *
 * PRIMARY STRATEGY: DOM-based collection via DomCollector.
 *   Scrolls the page to render all tracks, then reads el.data from each
 *   ytmusic-responsive-list-item-renderer (which contains the resolved
 *   setVideoId that the API never returns for tracks 101+).
 *
 * FALLBACK: API browse (first page only, ~100 tracks).
 *   Used when the DOM approach returns 0 results (e.g., unexpected page
 *   structure). This is a known-limited fallback — it will only shuffle
 *   the first ~100 tracks.
 */

import { logger } from '../utils/logger';
import { apiClient } from '../api/ytMusicApi';
import { domCollector } from './domCollector';
import type { PlaylistTrack } from '../api/types';

export type CollectorProgressFn = (params: {
  collected: number;
  phase: 'scrolling' | 'extracting' | 'api-fallback';
}) => void;

// ─────────────────────────────────────────────────────────────────────────────

export class PlaylistCollector {
  private onProgress: CollectorProgressFn | null = null;

  setProgressCallback(fn: CollectorProgressFn): void {
    this.onProgress = fn;
  }

  /**
   * Collect every track in the playlist currently rendered on the page.
   *
   * @param playlistId - Raw playlist ID (no "VL" prefix). Used only by the
   *                     API fallback; the DOM approach reads whatever is
   *                     currently displayed in the browser.
   * @param signal     - AbortSignal for cancellation.
   */
  async collectAll(
    playlistId: string,
    signal?: AbortSignal
  ): Promise<PlaylistTrack[]> {
    logger.time('collectAll');
    logger.info(`[Collector] Starting collection for playlist: ${playlistId}`);

    // ── PRIMARY: DOM-based collection ─────────────────────────────────────
    try {
      domCollector.setProgressCallback(loaded => {
        this.onProgress?.({ collected: loaded, phase: 'scrolling' });
      });

      const tracks = await domCollector.collectAll(signal);

      if (tracks.length > 0) {
        logger.timeEnd('collectAll');
        logger.info(`[Collector] DOM collection succeeded: ${tracks.length} tracks`);
        return tracks;
      }

      // DOM returned nothing — log clearly and fall through to API fallback.
      logger.warn(
        '[Collector] DOM collection returned 0 tracks. ' +
        'This usually means YTM rendered the page in an unexpected structure. ' +
        'Falling back to API browse (first ~100 tracks only).'
      );

    } catch (err) {
      // Re-throw cancellations; swallow everything else and try the fallback.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      logger.error('[Collector] DOM collection threw unexpectedly — falling back to API', err);
    }

    // ── FALLBACK: API browse (first page only) ────────────────────────────
    return this.collectViaApiFallback(playlistId, signal);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async collectViaApiFallback(
    playlistId: string,
    signal?: AbortSignal
  ): Promise<PlaylistTrack[]> {
    logger.warn(
      '[Collector] API fallback active — only the first ~100 tracks will be shuffled.'
    );

    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    this.onProgress?.({ collected: 0, phase: 'api-fallback' });

    try {
      const response = await apiClient.browsePlaylist(`VL${playlistId}`);
      const { tracks } = apiClient.extractTracks(response, 0);

      const valid = tracks.filter(
        t => t.videoId && t.setVideoId && t.setVideoId !== 'to_be_updated_by_client'
      );

      this.onProgress?.({ collected: valid.length, phase: 'api-fallback' });
      logger.info(`[Collector] API fallback: ${valid.length} valid tracks from first page`);

      return valid;

    } catch (err) {
      logger.error('[Collector] API fallback also failed', err);
      throw new Error(
        'Could not collect playlist tracks via either DOM or API. ' +
        'Make sure the playlist page has fully loaded and try again.'
      );
    }
  }
}

export const playlistCollector = new PlaylistCollector();
