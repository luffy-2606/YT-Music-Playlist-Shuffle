/**
 * PlaylistShuffler
 * We use ACTION_MOVE_VIDEO_BEFORE
 *
 * Strategy: right-to-left insertion:
 *   For i from (n-1) downto 1:
 *     Move T[i-1] immediately before T[i].
 */

import { logger } from '../utils/logger';
import { sleep, chunk } from '../utils/dom';
import { apiClient } from '../api/ytMusicApi';
import type { MoveVideoAction, PlaylistTrack } from '../api/types';

// Actions per API request
const BATCH_SIZE = 30;

// Delay between batches
const BATCH_DELAY_MS = 600;

// Sentinal value if no video id
const PLACEHOLDER_SET_VIDEO_ID = 'to_be_updated_by_client';

export type ShufflerProgressFn = (params: {
  completedMoves: number;
  totalMoves: number;
  batchIndex: number;
  totalBatches: number;
}) => void;

export class PlaylistShuffler {
  private onProgress: ShufflerProgressFn | null = null;

  setProgressCallback(fn: ShufflerProgressFn): void {
    this.onProgress = fn;
  }

  /**
   * Reorder `playlistId` so that its tracks match `desiredOrder`.
   *
   * Uses only ACTION_MOVE_VIDEO_BEFORE — the playlist is never emptied,
   * so a mid-operation failure leaves it in a partially-reordered (but
   * intact) state rather than wiped.
   *
   * @param playlistId   - Raw playlist ID (no "VL" prefix)
   * @param desiredOrder - Tracks in the desired final order; every track
   *                       MUST have a valid `setVideoId` (the per-entry
   *                       token assigned by YouTube Music, distinct from
   *                       `videoId` which is the video itself)
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

    // FIX: Guard against both missing AND placeholder setVideoId values.
    //
    // The original check (!t.setVideoId) only catches null/undefined/empty.
    // YouTube Music also emits the literal string "to_be_updated_by_client"
    // as a sentinel for unresolved tracks. That string is truthy, so it
    // bypasses the original guard and ends up in the actions array, causing
    // HTTP 400 INVALID_ARGUMENT for the entire batch.
    //
    // parseTrackItem in ytMusicApi.ts now drops these tracks at collection
    // time, so they should never reach here. This is a second line of defence.
    const missing = desiredOrder.filter(
      t => !t?.setVideoId || t.setVideoId === PLACEHOLDER_SET_VIDEO_ID
    );

    if (missing.length > 0) {
      throw new Error(
        `${missing.length} track(s) have a missing or placeholder setVideoId — ` +
        'try refreshing the page and reshuffling to get fresh tokens. ' +
        `Affected titles: ${missing.slice(0, 5).map(t => t.title).join(', ')}` +
        (missing.length > 5 ? ` … and ${missing.length - 5} more` : '')
      );
    }

    logger.time('applyOrder');
    logger.info(
      `Soft-shuffling playlist ${playlistId} (${desiredOrder.length} tracks)`
    );

    const n = desiredOrder.length;

    // place T[i-1] immediately before T[i]
    const actions: MoveVideoAction[] = [];
    for (let i = n - 1; i >= 1; i--) {
      actions.push({
        action: 'ACTION_MOVE_VIDEO_BEFORE',
        setVideoId: desiredOrder[i - 1].setVideoId!,
        movedSetVideoIdSuccessor: desiredOrder[i].setVideoId!,
      });
    }

    logger.info(`Generated ${actions.length} safe move operations`);

    const batches = chunk(actions, BATCH_SIZE);
    const totalMoves = actions.length;
    let completedMoves = 0;

    for (let bi = 0; bi < batches.length; bi++) {
      this.checkAbort(signal);

      await apiClient.editPlaylist(playlistId, batches[bi]);

      completedMoves += batches[bi].length;

      this.onProgress?.({
        completedMoves,
        totalMoves,
        batchIndex: bi + 1,
        totalBatches: batches.length,
      });

      // Skip the delay after the last batch
      if (bi < batches.length - 1) {
        this.checkAbort(signal);
        await sleep(BATCH_DELAY_MS);
      }
    }

    logger.timeEnd('applyOrder');
    logger.info('Playlist reorder complete');
  }

  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Reorder cancelled by user', 'AbortError');
    }
  }
}

export const playlistShuffler = new PlaylistShuffler();