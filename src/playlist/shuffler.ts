/**
 * PlaylistShuffler — applies a new track order to a YouTube Music playlist.
 *
 * ─── Algorithm ──────────────────────────────────────────────────────────────
 *
 * Goal: given a desired final order T[0..n-1], transform the playlist using
 * the minimum number of API calls (each call can carry multiple actions).
 *
 * We use ACTION_MOVE_VIDEO_BEFORE which means:
 *   "Move the item identified by setVideoId to be immediately before the item
 *    identified by movedSetVideoIdSuccessor."
 *
 * Strategy — right-to-left insertion:
 *   For i from (n-1) downto 1:
 *     Move T[i-1] immediately before T[i].
 *
 * Correctness proof sketch:
 *   After processing step i, the subsequence T[i-1..n-1] is correctly ordered.
 *   At step i, T[i] is already in its final relative position (processed earlier).
 *   Placing T[i-1] immediately before T[i] extends the ordered suffix by one.
 *   After step i=1, T[0..n-1] is fully ordered.
 *
 * Total moves: n-1
 * Batching: up to BATCH_SIZE moves per API request → ceil((n-1)/BATCH_SIZE) requests
 *
 * For 1000 tracks: 999 moves → 34 requests (at 30/batch) → ~17s with delays.
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

import { logger } from '../utils/logger';
import { sleep, chunk } from '../utils/dom';
import { apiClient } from '../api/ytMusicApi';
import type { MoveVideoAction, PlaylistTrack } from '../api/types';

/** Actions per API request. Stay well within YT Music's undocumented limit. */
const BATCH_SIZE = 30;

/** Delay between batches (ms). Keep well below rate-limit thresholds. */
const BATCH_DELAY_MS = 600;

export type ShufflerProgressFn = (params: {
  completedMoves: number;
  totalMoves: number;
  batchIndex: number;
  totalBatches: number;
}) => void;

// ─────────────────────────────────────────────────────────────────────────────

export class PlaylistShuffler {
  private onProgress: ShufflerProgressFn | null = null;

  setProgressCallback(fn: ShufflerProgressFn): void {
    this.onProgress = fn;
  }

  /**
   * Reorder `playlistId` so that its tracks match `desiredOrder`.
   *
   * @param playlistId   - Raw playlist ID (no "VL" prefix)
   * @param desiredOrder - Tracks in the desired final order
   * @param signal       - Optional AbortSignal for cancellation
   */
  async applyOrder(
    playlistId: string,
    desiredOrder: PlaylistTrack[],
    signal?: AbortSignal
  ): Promise<void> {
    if (desiredOrder.length < 2) {
      logger.info('Fewer than 2 tracks — nothing to reorder');
      return;
    }

    logger.time('applyOrder');
    logger.info(
      `Applying new order to playlist ${playlistId} (${desiredOrder.length} tracks)`
    );

    // Build move actions: process right-to-left
    const actions: MoveVideoAction[] = [];
    for (let i = desiredOrder.length - 1; i >= 1; i--) {
      const item = desiredOrder[i - 1];
      const successor = desiredOrder[i];

      // Both items must have a setVideoId
      if (!item || !successor || !item.setVideoId || !successor.setVideoId) {
        logger.warn(`Skipping move at index ${i}: missing setVideoId`);
        continue;
      }

      actions.push({
        action: 'ACTION_MOVE_VIDEO_BEFORE',
        setVideoId: item.setVideoId,
        movedSetVideoIdSuccessor: successor.setVideoId,
      });
    }

    logger.info(`Generated ${actions.length} move action(s)`);

    const batches = chunk(actions, BATCH_SIZE);
    const totalBatches = batches.length;
    let completedMoves = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      this.checkAbort(signal);

      const batch = batches[batchIdx];
      if (!batch) continue;

      logger.debug(
        `Batch ${batchIdx + 1}/${totalBatches}: ${batch.length} action(s)`
      );

      try {
        const result = await apiClient.editPlaylist(playlistId, batch);

        if (result.status && result.status !== 'STATUS_SUCCEEDED') {
          logger.warn(
            `Unexpected status from edit_playlist: ${result.status}`,
            result
          );
        }

        completedMoves += batch.length;
        this.onProgress?.({
          completedMoves,
          totalMoves: actions.length,
          batchIndex: batchIdx + 1,
          totalBatches,
        });

        logger.debug(
          `Batch ${batchIdx + 1} OK — ${completedMoves}/${actions.length} moves complete`
        );
      } catch (err) {
        logger.error(`Batch ${batchIdx + 1} failed`, err);
        throw new Error(
          `Reorder failed at batch ${batchIdx + 1}/${totalBatches}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // Rate-limit gap between batches (skip after last)
      if (batchIdx < batches.length - 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    logger.timeEnd('applyOrder');
    logger.info('All move actions applied successfully');
  }

  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Reorder cancelled by user', 'AbortError');
    }
  }
}

export const playlistShuffler = new PlaylistShuffler();
