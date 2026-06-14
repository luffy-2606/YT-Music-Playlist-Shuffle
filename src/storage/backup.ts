/**
 * BackupManager — persists the original playlist order before shuffling.
 *
 * Storage layout (chrome.storage.local):
 *   Key:   "ytms_backup_<playlistId>"
 *   Value: PlaylistBackup (see type below)
 *
 * Backups older than MAX_AGE_MS are considered expired and are ignored.
 */

import { logger } from '../utils/logger';
import type { PlaylistTrack } from '../api/types';

const KEY_PREFIX = 'ytms_backup_';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PlaylistBackup {
  playlistId: string;
  playlistTitle: string;
  savedAt: string; // ISO-8601
  trackCount: number;
  tracks: PlaylistTrack[];
}

// ─────────────────────────────────────────────────────────────────────────────

export class BackupManager {
  private key(playlistId: string): string {
    return `${KEY_PREFIX}${playlistId}`;
  }

  /** Save the current track order as the backup for `playlistId`. */
  async save(
    playlistId: string,
    playlistTitle: string,
    tracks: PlaylistTrack[]
  ): Promise<void> {
    const backup: PlaylistBackup = {
      playlistId,
      playlistTitle,
      savedAt: new Date().toISOString(),
      trackCount: tracks.length,
      tracks: tracks.map((t, i) => ({ ...t, index: i })),
    };

    await chrome.storage.local.set({ [this.key(playlistId)]: backup });

    logger.info(
      `Backup saved: "${playlistTitle}" (${tracks.length} tracks) → ${this.key(playlistId)}`
    );
  }

  /**
   * Load the backup for `playlistId`.
   * Returns `null` if no backup exists or it has expired.
   */
  async load(playlistId: string): Promise<PlaylistBackup | null> {
    const result = await chrome.storage.local.get(this.key(playlistId));
    const backup = result[this.key(playlistId)] as PlaylistBackup | undefined;

    if (!backup) {
      logger.debug(`No backup for playlist ${playlistId}`);
      return null;
    }

    const ageMs = Date.now() - new Date(backup.savedAt).getTime();
    if (ageMs > MAX_AGE_MS) {
      logger.warn(
        `Backup for ${playlistId} is ${Math.floor(ageMs / 86_400_000)} days old — ignoring`
      );
      // Silently remove expired backup
      await this.delete(playlistId);
      return null;
    }

    logger.info(
      `Backup loaded: "${backup.playlistTitle}" (${backup.trackCount} tracks, saved ${backup.savedAt})`
    );
    return backup;
  }

  /** Remove the backup for `playlistId`. */
  async delete(playlistId: string): Promise<void> {
    await chrome.storage.local.remove(this.key(playlistId));
    logger.debug(`Backup deleted for playlist ${playlistId}`);
  }

  /** True if a valid (non-expired) backup exists. */
  async exists(playlistId: string): Promise<boolean> {
    return (await this.load(playlistId)) !== null;
  }

  /** List all stored backups (newest first), skipping expired entries. */
  async listAll(): Promise<PlaylistBackup[]> {
    const all = await chrome.storage.local.get(null);
    const backups: PlaylistBackup[] = [];

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const b = value as PlaylistBackup;
      const age = Date.now() - new Date(b.savedAt).getTime();
      if (age <= MAX_AGE_MS) {
        backups.push(b);
      }
    }

    return backups.sort(
      (a, b) =>
        new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  }

  /** Remove all expired backups from storage. */
  async pruneExpired(): Promise<number> {
    const all = await chrome.storage.local.get(null);
    const toRemove: string[] = [];

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const b = value as PlaylistBackup;
      const age = Date.now() - new Date(b.savedAt).getTime();
      if (age > MAX_AGE_MS) toRemove.push(key);
    }

    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      logger.info(`Pruned ${toRemove.length} expired backup(s)`);
    }

    return toRemove.length;
  }
}

export const backupManager = new BackupManager();
