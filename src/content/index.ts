/*
 * Content script entry point for YT Music True Shuffle.
 *
 * Responsibilities:
 *  1. Detect playlist pages
 *  2. Inject "True Shuffle" + "Restore" buttons into the playlist header
 *  3. Shuffle flow:
 *       collect tracks -> backup -> shuffle -> apply order
 *  4. Handle SPA navigation
 *  5. Support cancellation mid-operation
 */

import { logger } from '../utils/logger';
import { isPlaylistPage, getPlaylistIdFromUrl, sleep } from '../utils/dom';
import { NavigationDetector } from '../utils/navigation';
import { shuffleAndVerify } from '../utils/shuffle';
import { apiClient } from '../api/ytMusicApi';
import { playlistCollector } from '../playlist/collector';
import { playlistShuffler } from '../playlist/shuffler';
import { backupManager } from '../storage/backup';
import { buttonInjector } from '../ui/button';
import { ProgressModal } from '../ui/progressModal';
import type { PlaylistTrack } from '../api/types';

// time to wait for navigation
const NAV_SETTLE_MS = 1_200;

// time to wait after navigation to inject
const INJECT_DELAY_MS = 1_800;

class TrueShuffleExtension {
  private nav = new NavigationDetector();
  private currentPlaylistId: string | null = null;
  private operationInProgress = false;
  private apiReady = false;

  async boot(): Promise<void> {
    logger.info('YT Music True Shuffle booting...');

    // Initialise the API client
    await this.initApi();

    // Listen for SPA route changes
    this.nav.onNavigate((_url, _prev) => {
      setTimeout(() => this.handleRouteChange(), NAV_SETTLE_MS);
    });

    // Handle the current page immediately
    await this.handleRouteChange();

    logger.info('Boot complete');
  }

  private async handleRouteChange(): Promise<void> {
    const playlistId = getPlaylistIdFromUrl();

    if (!isPlaylistPage() || !playlistId) {
      // Navigated away from a playlist
      if (this.currentPlaylistId) {
        buttonInjector.destroy();
        this.currentPlaylistId = null;
      }
      return;
    }

    // Same playlist — no need to re-inject unless buttons are gone
    if (
      playlistId === this.currentPlaylistId &&
      document.getElementById('ytms-btn-wrap')
    ) {
      return;
    }

    this.currentPlaylistId = playlistId;

    if (!this.apiReady) await this.initApi();

    await sleep(INJECT_DELAY_MS);

    // Guard: user may have navigated away during the delay
    if (getPlaylistIdFromUrl() !== playlistId) return;

    await buttonInjector.inject(playlistId, {
      onShuffle: () => void this.runShuffle(playlistId),
      onRestore: () => void this.runRestore(playlistId),
      hasBackup: () => backupManager.exists(playlistId),
    });
  }

  // API initialisation

  private async initApi(): Promise<void> {
    try {
      await apiClient.initialize();
      this.apiReady = true;
    } catch (err) {
      logger.error('API init failed', err);
    }
  }

  // Shuffle operation 

  private async runShuffle(playlistId: string): Promise<void> {
    if (this.operationInProgress) {
      ProgressModal.toast('A shuffle is already in progress', 'info');
      return;
    }

    this.operationInProgress = true;
    buttonInjector.setLoading(true);

    const modal = new ProgressModal();
    modal.show('True Shuffle');

    try {
      // Step 1: Collect tracks
      modal.update({
        status: 'Scrolling playlist to load all tracks…',
        progressLabel: 'Scroll to load tracks 101+',
      });

      let tracks: PlaylistTrack[] = [];

      playlistCollector.setProgressCallback(({ collected, phase }) => {
        if (phase === 'scrolling') {
          modal.update({
            status: `Scrolling to load all tracks… (${collected} loaded so far)`,
            progressLabel: `${collected} tracks visible`,
          });
        } else if (phase === 'extracting') {
          modal.update({
            status: `Reading track data from page…`,
            progressLabel: `${collected} tracks found`,
          });
        } else {
          // api-fallback
          modal.update({
            status: `⚠️ DOM read failed! -> using API fallback (first ~100 tracks only)`,
            progressLabel: `${collected} tracks`,
          });
        }
      });

      tracks = await playlistCollector.collectAll(playlistId, modal.signal);

      if (modal.cancelled) {
        modal.hide();
        ProgressModal.toast('Shuffle cancelled', 'info');
        return;
      }

      if (tracks.length < 2) {
        throw new UserFacingError(
          `Only ${tracks.length} track(s) found.\n\n` +
            'Make sure:\n' +
            '• You are signed in to YouTube Music\n' +
            '• This is a playlist you own (not a mix or radio)\n' +
            '• The playlist has at least 2 tracks\n\n' +
            'If the playlist is large, try scrolling it manually first, then shuffle.'
        );
      }

      modal.update({
        status: `Loaded ${tracks.length} tracks. Saving backup…`,
        progress: 20,
        progressLabel: `${tracks.length} tracks`,
      });

      // Step 2: Backup
      const playlistTitle =
        document.querySelector(
          'ytmusic-detail-header-renderer h2, ytmusic-responsive-header-renderer h2, .ytmusic-detail-header-renderer yt-formatted-string.title'
        )?.textContent?.trim() ??
        document.title.replace(' - YouTube Music', '').trim() ??
        'Unknown Playlist';

      await backupManager.save(playlistId, playlistTitle, tracks);

      modal.update({
        status: 'Computing random order…',
        progress: 28,
      });

      // Step 3: Shuffle
      await sleep(200);
      const shuffled = shuffleAndVerify(tracks);

      modal.update({
        status: `Applying new order to playlist…`,
        progress: 32,
        progressLabel: `0 / ${tracks.length - 1} moves`,
      });

      // Step 4: Apply
      playlistShuffler.setProgressCallback(
        ({ completedMoves, totalMoves, batchIndex, totalBatches }) => {
          const pct = 32 + Math.round((completedMoves / totalMoves) * 63);
          modal.update({
            status: `Reordering… (batch ${batchIndex}/${totalBatches})`,
            progress: pct,
            progressLabel: `${completedMoves} / ${totalMoves} moves`,
          });
        }
      );

      await playlistShuffler.applyOrder(playlistId, shuffled, modal.signal);

      if (modal.cancelled) {
        modal.hide();
        ProgressModal.toast(
          'Shuffle cancelled — playlist may be partially reordered. Use Restore to undo.',
          'error'
        );
        buttonInjector.setRestoreVisible(true);
        return;
      }

      modal.update({
        status: 'DONE!!!',
        progress: 100,
        progressLabel: `${tracks.length} tracks reordered`,
        canClose: true,
      });

      // Prune stale backups in the background
      void backupManager.pruneExpired();

      // Step 5: Success
      await sleep(400);
      modal.showSuccess(
        `${tracks.length} tracks shuffled and saved to your playlist.\n` +
          `A backup of the original order has been stored for 7 days.`,
        {
          onClose: () => buttonInjector.setRestoreVisible(true),
          onRestore: () => void this.runRestore(playlistId),
        }
      );

    } catch (err) {
      this.handleOperationError(modal, err);
    } finally {
      this.operationInProgress = false;
      buttonInjector.setLoading(false);
    }
  }

  // Restore operation

  private async runRestore(playlistId: string): Promise<void> {
    if (this.operationInProgress) {
      ProgressModal.toast('An operation is already in progress', 'info');
      return;
    }

    const backup = await backupManager.load(playlistId);
    if (!backup) {
      ProgressModal.toast('No backup found for this playlist', 'error');
      buttonInjector.setRestoreVisible(false);
      return;
    }

    const savedDate = new Date(backup.savedAt).toLocaleString();
    const confirmed = window.confirm(
      `Restore "${backup.playlistTitle}" to its order from ${savedDate}?\n\n` +
        `This will permanently move ${backup.trackCount} tracks back to their original positions.`
    );
    if (!confirmed) return;

    this.operationInProgress = true;
    buttonInjector.setLoading(true);

    const modal = new ProgressModal();
    modal.show('Restore Original Order');

    try {
      modal.update({
        status: `Restoring ${backup.trackCount} tracks…`,
        progress: undefined,
        progressLabel: `0 / ${backup.trackCount - 1} moves`,
      });

      playlistShuffler.setProgressCallback(
        ({ completedMoves, totalMoves, batchIndex, totalBatches }) => {
          const pct = Math.round((completedMoves / totalMoves) * 95);
          modal.update({
            status: `Restoring… (batch ${batchIndex}/${totalBatches})`,
            progress: pct,
            progressLabel: `${completedMoves} / ${totalMoves} moves`,
          });
        }
      );

      await playlistShuffler.applyOrder(playlistId, backup.tracks, modal.signal);

      modal.update({
        status: 'Restored!',
        progress: 100,
        progressLabel: `${backup.trackCount} tracks`,
        canClose: true,
      });

      await backupManager.delete(playlistId);

      await sleep(400);
      modal.showSuccess(
        `${backup.trackCount} tracks have been restored to the order from ${savedDate}.`,
        {
          onClose: () => buttonInjector.setRestoreVisible(false),
        }
      );

    } catch (err) {
      this.handleOperationError(modal, err);
    } finally {
      this.operationInProgress = false;
      buttonInjector.setLoading(false);
    }
  }

  // Error handling

  private handleOperationError(modal: ProgressModal, err: unknown): void {
    const isAbort =
      err instanceof DOMException && err.name === 'AbortError';

    if (isAbort) {
      modal.hide();
      ProgressModal.toast('Operation cancelled', 'info');
      return;
    }

    const message =
      err instanceof UserFacingError
        ? err.message
        : buildErrorMessage(err);

    logger.error('Operation failed', err);
    modal.showError(message);
  }
}

// Error helpers 

/** Errors that carry a message safe to show directly in the UI. */
class UserFacingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UserFacingError';
  }
}

function buildErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  if (err.message.includes('HTTP 401') || err.message.includes('HTTP 403')) {
    return (
      'Authentication failed (401/403).\n\n' +
      'Make sure you are signed into YouTube Music and that you own this playlist. ' +
      'Auto-generated playlists (mixes, radios) cannot be reordered.'
    );
  }

  if (err.message.includes('HTTP 404')) {
    return 'Playlist not found (404). The playlist may have been deleted or made private.';
  }

  if (err.message.includes('HTTP 429') || err.message.includes('quota')) {
    return (
      'YouTube Music rate-limited the request (429).\n\n' +
      'Wait a few minutes and try again. For very large playlists, consider shuffling in smaller batches.'
    );
  }

  if (
    err.message.toLowerCase().includes('networkerror') ||
    err.message.toLowerCase().includes('failed to fetch')
  ) {
    return 'Network error. Check your internet connection and try again.';
  }

  return (
    `An unexpected error occurred:\n\n${err.message}\n\n` +
    'Open the browser DevTools console (F12) and look for [YTMS] messages for details.'
  );
}

// Boot

const extension = new TrueShuffleExtension();
extension.boot().catch(err => {
  logger.error('Fatal boot error', err);
});