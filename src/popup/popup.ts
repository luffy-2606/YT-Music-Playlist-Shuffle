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
        <div class="icon">
          <img src="YT-Music-Logo.png" alt="YT Music Logo" class="empty-state-logo" />
        </div>
        <p>Open a YouTube Music playlist to use True Shuffle.</p>
      </div>`;
    return;
  }

  // Fallback: Extract the real playlist title directly from the browser tab
  let structuralPlaylistName = currentListId; 
  if (tab.title) {
    structuralPlaylistName = tab.title.replace(' - YouTube Music', '').trim();
  }

  // Load backup info
  const allData = await chrome.storage.local.get(null);
  const backup = allData[`${KEY_PREFIX}${currentListId}`] as
    | PlaylistBackup
    | undefined;

  // Read backup.playlistTitle if it exists
  const displayName = backup?.playlistTitle || structuralPlaylistName;

  const backupHtml = backup
    ? `<div class="backup-row">
         <span class="backup-badge">✓ Backup saved</span>
         <span class="backup-meta">
           ${new Date(backup.savedAt).toLocaleDateString()} · ${backup.tracks?.length || 0} tracks
         </span>
       </div>`
    : `<div class="no-backup">No backup for this playlist yet.</div>`;

    root.innerHTML = `
    <div class="on-playlist">
      <div class="playlist-label">Current playlist</div>
      <div class="playlist-title">${displayName}</div>

      <button id="shuffle-btn" class="btn-primary" disabled>
        Connecting to page...
      </button>

      ${backup
        ? `<button id="restore-btn" class="btn-secondary" disabled>
             Connecting to page...
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

  // Connection Handshake Status
  const shuffleBtn = document.getElementById('shuffle-btn') as HTMLButtonElement;
  const restoreBtn = document.getElementById('restore-btn') as HTMLButtonElement | null;

  // Poll the content script until it responds or times out
  let contentScriptReady = false;
  for (let i = 0; i < 100; i++) { // 100*300 ms delay (30 sec)
    try {
      await chrome.tabs.sendMessage(tab.id!, { type: 'YTMS_PING' });
      contentScriptReady = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Only enable the buttons if the content script actually responded!
  if (contentScriptReady) {
    if (shuffleBtn) {
      shuffleBtn.disabled = false;
      shuffleBtn.textContent = 'Permanently Shuffle';
    }
    if (restoreBtn) {
      restoreBtn.disabled = false;
      restoreBtn.innerHTML = '<span class="btn-icon">↩</span> Restore original order';
    }
  } else {
    // If it never connected after 15 attempts, keep them disabled and update text
    if (shuffleBtn) {
      shuffleBtn.textContent = 'Connection failed!';
    }
    if (restoreBtn) {
      restoreBtn.textContent = 'Connection failed!';
    }
    showError('Extension connection timed out. Please refresh your YouTube Music page.');
  }

  // Shuffle button
  document.getElementById('shuffle-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('shuffle-btn') as HTMLButtonElement;
    btn.disabled    = true;
    btn.textContent = 'Starting...';

    try {
      await chrome.tabs.sendMessage(tab.id!, { type: 'YTMS_SHUFFLE' });
      await chrome.tabs.update(tab.id!, { active: true });
      window.close();
    } catch {
      btn.disabled    = false;
      btn.innerHTML   = 'Permanently Shuffle';
      showError('Could not reach the page. Make sure the playlist is fully loaded and try again.');
    }
  });

  // Restore button
  document.getElementById('restore-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('restore-btn') as HTMLButtonElement;
    btn.disabled    = true;
    btn.textContent = 'Starting...';

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

  // Clear Backups button
  document.getElementById('clear-backups')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Delete all saved playlist backups?')) return;
    
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('ytms_backup_'));
    
    if (keys.length) {
      await chrome.storage.local.remove(keys);
      alert(`Cleared ${keys.length} backup(s).`);
    } else {
      alert('No backups to clear.');
    }
    window.location.reload();
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

document.addEventListener('DOMContentLoaded', init);