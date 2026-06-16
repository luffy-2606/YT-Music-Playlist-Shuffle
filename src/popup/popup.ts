/**
 * Extension popup script.
 * Reads backup info from chrome.storage.local and shows it to the user.
 */

import type { PlaylistBackup } from '../storage/backup';

const KEY_PREFIX = 'ytms_backup_';

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const onPlaylist = !!tab?.url?.match(/music\.youtube\.com\/playlist\?list=/);
  const currentListId = tab?.url
    ? new URL(tab.url).searchParams.get('list')
    : null;

  const root = document.getElementById('app');
  if (!root) return;

  // Not on a playlist page
  if (!onPlaylist || !currentListId || !tab?.id) {
    root.innerHTML = `
      <div class="state-empty">
        <div class="icon">🎵</div>
        <p>Open a YouTube Music playlist to use True Shuffle.</p>
      </div>`;
    return;
  }

  // Load backup info
  const allData = await chrome.storage.local.get(null);
  const backup = allData[`${KEY_PREFIX}${currentListId}`] as
    | PlaylistBackup
    | undefined;

  const backupHtml = backup
    ? `<div class="backup-row">
         <span class="backup-badge">✓ Backup saved</span>
         <span class="backup-meta">
           ${new Date(backup.savedAt).toLocaleDateString()} · ${backup.trackCount} tracks
         </span>
       </div>`
    : `<div class="no-backup">No backup for this playlist yet.</div>`;

  const playlistTitle = backup?.playlistTitle ?? '';

  root.innerHTML = `
    <div class="on-playlist">
      <div class="playlist-label">Current playlist</div>
      <div class="playlist-title">${esc(playlistTitle)}</div>

      <button id="shuffle-btn" class="btn-primary">
        Permanently Shuffle
      </button>

      ${backup
        ? `<button id="restore-btn" class="btn-secondary">
             <span class="btn-icon">↩</span> Restore original order
           </button>`
        : ''}

      ${backupHtml}

      <div class="divider"></div>
      <div class="hint">
        Shuffle permanently reorders your playlist.<br>
        A backup is saved (in your local storage) automatically before any changes.
      </div>
    </div>
  `;

  // Shuffle button
  document.getElementById('shuffle-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('shuffle-btn') as HTMLButtonElement;
    btn.disabled    = true;
    btn.textContent = '⏳ Starting…';

    try {
      await chrome.tabs.sendMessage(tab.id!, { type: 'YTMS_SHUFFLE' });
      // Focus the tab so the user can see the progress modal
      await chrome.tabs.update(tab.id!, { active: true });
      window.close();
    } catch {
      btn.disabled    = false;
      btn.innerHTML   = 'Permanently Shuffle';
      showError('Could not reach the page. Make sure the playlist is fully loaded and try again.');
    }
  });

  // ── Restore button ───────────────────────────────────────────────────────
  document.getElementById('restore-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('restore-btn') as HTMLButtonElement;
    btn.disabled    = true;
    btn.textContent = '⏳ Starting…';

    try {
      await chrome.tabs.sendMessage(tab.id!, { type: 'YTMS_RESTORE' });
      await chrome.tabs.update(tab.id!, { active: true });
      window.close();
    } catch {
      btn.disabled    = false;
      btn.innerHTML   = '<span class="btn-icon">↩</span> Restore original order';
      showError('Could not reach the page. Make sure the playlist is open and try again.');
    }
  });
}

function showError(msg: string): void {
  const existing = document.getElementById('popup-error');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id        = 'popup-error';
  div.className = 'error-msg';
  div.textContent = msg;
  document.getElementById('app')?.appendChild(div);
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

init().catch(console.error);
