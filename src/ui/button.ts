/**
 * ButtonInjector — injects the "True Shuffle" and "Restore" buttons into the
 * YouTube Music playlist header.
 */

import { logger } from '../utils/logger';
import { waitForFirstElement } from '../utils/dom';
import { EXTENSION_STYLES } from './styles';

const WRAP_ID = 'ytms-btn-wrap';
const STYLES_ID = 'ytms-styles';

/**
 * Ranked candidate selectors for the playlist action bar.
 * Ordered from most to least specific.
 */
const HEADER_SELECTORS = [
  // YTM detail header
  'ytmusic-detail-header-renderer .action-buttons',
  'ytmusic-detail-header-renderer .buttons',

  // Responsive header
  'ytmusic-responsive-header-renderer .action-buttons',
  'ytmusic-responsive-header-renderer .buttons',

  // Immersive header
  'ytmusic-immersive-header-renderer .action-buttons',

  // Fallback:
  'ytmusic-detail-header-renderer',
  'ytmusic-responsive-header-renderer',
  'ytmusic-immersive-header-renderer',
];

const SVG_SHUFFLE = `
<svg class="ytms-btn-icon" viewBox="0 0 24 24">
  <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
</svg>`;

const SVG_RESTORE = `
<svg class="ytms-btn-icon" viewBox="0 0 24 24">
  <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
</svg>`;

const SVG_SPIN = `
<svg class="ytms-btn-icon ytms-spinning" viewBox="0 0 24 24">
  <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 14.03 20 13.07 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
</svg>`;

export interface ButtonCallbacks {
  onShuffle: () => void;
  onRestore: () => void;
  hasBackup: () => Promise<boolean>;
}

export class ButtonInjector {
  private shuffleBtn: HTMLButtonElement | null = null;
  private restoreBtn: HTMLButtonElement | null = null;
  private reAttachObserver: MutationObserver | null = null;
  private currentPlaylistId: string | null = null;
  private callbacks: ButtonCallbacks | null = null;

  /* Inject buttons for `playlistId`. */
  async inject(playlistId: string, callbacks: ButtonCallbacks): Promise<boolean> {
    // Skip if already injected for the same playlist
    if (
      this.currentPlaylistId === playlistId &&
      document.getElementById(WRAP_ID)
    ) {
      return true;
    }

    this.destroy();
    this.callbacks = callbacks;
    this.currentPlaylistId = playlistId;

    this.ensureStyles();

    const found = await waitForFirstElement(HEADER_SELECTORS, 8_000);
    if (!found) {
      logger.warn('Could not find playlist header — button injection failed');
      return false;
    }
    
    const wrap = this.buildButtonWrap();
    found.el.appendChild(wrap);

    // check for existing backup and show restore btn if needed
    callbacks.hasBackup().then(has => {
      this.setRestoreVisible(has);
    });

    this.startReAttachObserver(found.el);

    return true;
  }

  /** Remove buttons and clean up. */
  destroy(): void {
    document.getElementById(WRAP_ID)?.remove();
    this.shuffleBtn = null;
    this.restoreBtn = null;
    this.currentPlaylistId = null;
    this.callbacks = null;
    this.reAttachObserver?.disconnect();
    this.reAttachObserver = null;
  }

  /** Put the shuffle button into loading state. */
  setLoading(loading: boolean): void {
    if (!this.shuffleBtn) return;
    this.shuffleBtn.disabled = loading;
    this.shuffleBtn.innerHTML = loading
      ? `${SVG_SPIN} Shuffling…`
      : `${SVG_SHUFFLE} True Shuffle`;
  }

  /** Show or hide the Restore button. */
  setRestoreVisible(visible: boolean): void {
    if (!this.restoreBtn) return;
    this.restoreBtn.style.display = visible ? 'inline-flex' : 'none';
  }

  private buildButtonWrap(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.className = 'ytms-btn-wrap';

    const shuffle = document.createElement('button');
    shuffle.className = 'ytms-shuffle-btn';
    shuffle.innerHTML = `${SVG_SHUFFLE} True Shuffle`;
    shuffle.title = 'Permanently reorder this playlist using a true random shuffle';
    shuffle.addEventListener('click', e => {
      e.stopPropagation();
      this.callbacks?.onShuffle();
    });

    const restore = document.createElement('button');
    restore.className = 'ytms-restore-btn';
    restore.innerHTML = `${SVG_RESTORE} Restore`;
    restore.title = 'Restore the original pre-shuffle track order';
    restore.style.display = 'none';
    restore.addEventListener('click', e => {
      e.stopPropagation();
      this.callbacks?.onRestore();
    });

    wrap.appendChild(shuffle);
    wrap.appendChild(restore);

    this.shuffleBtn = shuffle;
    this.restoreBtn = restore;

    return wrap;
  }

  /**
   * Watch for YTM re-rendering the header (which can remove buttons).
   * Re-inject if the wrap disappears while still on the same playlist.
   */
  private startReAttachObserver(headerEl: Element): void {
    this.reAttachObserver?.disconnect();

    this.reAttachObserver = new MutationObserver(() => {
      if (!document.getElementById(WRAP_ID) && this.callbacks) {
        logger.debug('Button wrap removed by YTM — re-attaching');
        const newWrap = this.buildButtonWrap();
        headerEl.appendChild(newWrap);
        this.callbacks.hasBackup().then(has => this.setRestoreVisible(has));
      }
    });

    this.reAttachObserver.observe(headerEl, {
      childList: true,
      subtree: true,
    });
  }

  private ensureStyles(): void {
    if (document.getElementById(STYLES_ID)) return;
    const style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = EXTENSION_STYLES;
    document.head.appendChild(style);
  }
}

export const buttonInjector = new ButtonInjector();
