/**
 * Extension popup script.
 * Reads backup info from chrome.storage.local and shows it to the user.
 */

import type { PlaylistBackup } from '../storage/backup';

const KEY_PREFIX = 'ytms_backup_';

async function init(): Promise<void> {
  const allData = await chrome.storage.local.get(null);
  const backups: PlaylistBackup[] = Object.entries(allData)
    .filter(([k]) => k.startsWith(KEY_PREFIX))
    .map(([, v]) => v as PlaylistBackup)
    .sort(
      (a, b) =>
        new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );

  const tab = await getActiveTab();
  const onPlaylist =
    !!tab?.url?.match(/music\.youtube\.com\/playlist\?list=/);

  const currentListId = tab?.url
    ? new URL(tab.url).searchParams.get('list')
    : null;

  const root = document.getElementById('app');
  if (!root) return;

  if (!onPlaylist) {
    root.innerHTML = `
      <div class="state-empty">
        <div class="icon">🎵</div>
        <p>Open a YouTube Music playlist to use True Shuffle.</p>
      </div>`;
    return;
  }

  const currentBackup = backups.find(b => b.playlistId === currentListId);

  root.innerHTML = `
    <div class="on-playlist">
      <div class="playlist-label">Current playlist</div>
      <div class="playlist-title">${esc(currentBackup?.playlistTitle ?? 'Unknown playlist')}</div>

      ${
        currentBackup
          ? `<div class="backup-info">
               <span class="backup-badge">✓ Backup saved</span>
               <span class="backup-date">${new Date(currentBackup.savedAt).toLocaleString()}</span>
               <span class="backup-count">${currentBackup.trackCount} tracks</span>
             </div>
             <button id="restore-btn" class="btn-restore">↩ Restore original order</button>`
          : '<div class="no-backup">No backup for this playlist yet.</div>'
      }

      <div class="divider"></div>
      <div class="hint">
        Click <strong>True Shuffle</strong> on the playlist page to shuffle.
        A backup is saved automatically before any changes.
      </div>
    </div>
  `;

  document.getElementById('restore-btn')?.addEventListener('click', async () => {
    if (!tab?.id) return;
    const btn = document.getElementById('restore-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Restoring…';

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'YTMS_RESTORE' });
      window.close();
    } catch {
      btn.textContent = '⚠ Could not reach page — try clicking Restore on the playlist directly';
      btn.disabled = false;
    }
  });
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

init().catch(console.error);
