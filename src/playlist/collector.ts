/**
 * PlaylistCollector — fetches all tracks in a playlist via the browse API.
 *
 * YouTube Music lazy-loads playlists using continuation tokens. This module
 * follows every continuation page until all tracks are collected.
 */

import { logger } from '../utils/logger';
import { sleep } from '../utils/dom';
import { apiClient } from '../api/ytMusicApi';
import type { PlaylistTrack } from '../api/types';

/** Hard cap to prevent infinite loops on pathological playlists. */
const MAX_TRACKS = 5_000;

/** Delay between continuation requests to avoid rate-limiting. */
const CONTINUATION_DELAY_MS = 350;

/** Max time to spend collecting a single playlist (5 minutes). */
const MAX_COLLECTION_TIME_MS = 5 * 60 * 1000;

export type CollectorProgressFn = (params: {
  collected: number;
  page: number;
}) => void;

// ─────────────────────────────────────────────────────────────────────────────

export class PlaylistCollector {
  private onProgress: CollectorProgressFn | null = null;

  setProgressCallback(fn: CollectorProgressFn): void {
    this.onProgress = fn;
  }

  /**
   * Collect every track in `playlistId`.
   *
   * @param playlistId - Raw playlist ID (e.g. "PLxxx"). The "VL" prefix is
   *                     added internally for the browse API.
   * @param signal     - Optional AbortSignal for cancellation.
   */
  async collectAll(
    playlistId: string,
    signal?: AbortSignal
  ): Promise<PlaylistTrack[]> {
    const startTime = Date.now();
    logger.time('collectAll');
    logger.info(`Starting collection for playlist: ${playlistId}`);

    const allTracks: PlaylistTrack[] = [];
    let continuation: string | null = null;
    let page = 1;

    // ── First page ──────────────────────────────────────────────────────
    this.checkAbort(signal);
    const firstResponse = await apiClient.browsePlaylist(`VL${playlistId}`);
    const first = apiClient.extractTracks(firstResponse, 0);

    allTracks.push(...first.tracks);
    continuation = first.continuation;

    logger.info(`Page 1: ${first.tracks.length} tracks, continuation=${!!continuation}`);
    this.onProgress?.({ collected: allTracks.length, page });

    // ── Continuation pages ───────────────────────────────────────────────
    while (continuation && allTracks.length < MAX_TRACKS) {
      this.checkAbort(signal);

      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_COLLECTION_TIME_MS) {
        logger.warn(`Collection timed out after ${Math.round(elapsed / 1000)}s`);
        break;
      }

      await sleep(CONTINUATION_DELAY_MS);
      this.checkAbort(signal);

      page++;
      logger.debug(`Fetching page ${page}…`);

      const resp = await apiClient.browsePlaylistContinuation(continuation);
      const parsed = apiClient.extractTracks(resp, allTracks.length);

      if (parsed.tracks.length === 0) {
        // Empty page = we're done (server may still return a continuation token)
        logger.warn(`Page ${page} returned 0 tracks — stopping early`);
        break;
      }

      allTracks.push(...parsed.tracks);
      continuation = parsed.continuation;

      logger.debug(
        `Page ${page}: ${parsed.tracks.length} new, ${allTracks.length} total`
      );
      this.onProgress?.({ collected: allTracks.length, page });
    }

    if (allTracks.length >= MAX_TRACKS) {
      logger.warn(`Hit MAX_TRACKS cap (${MAX_TRACKS})`);
    }

    logger.timeEnd('collectAll');

    // Filter out any items without a valid setVideoId (they cannot be reordered)
    const valid = allTracks.filter(t => t.videoId && t.setVideoId);
    const dropped = allTracks.length - valid.length;
    if (dropped > 0) {
      logger.warn(`Dropped ${dropped} tracks without valid IDs`);
    }

    logger.info(
      `Collection complete: ${valid.length} valid tracks across ${page} page(s)`
    );

    return valid;
  }

  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Collection cancelled by user', 'AbortError');
    }
  }
}

export const playlistCollector = new PlaylistCollector();
