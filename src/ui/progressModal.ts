/**
 * ProgressModal: blocking modal that shows live shuffle progress.
 */

const ICONS = {
  shuffle: `<svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`,
  check:   `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  error:   `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  restore: `<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`,
} as const;

export interface ModalUpdateOptions {
  status?: string;
  progress?: number;
  progressLabel?: string;
  canClose?: boolean;
}

export class ProgressModal {
  private overlay: HTMLDivElement | null = null;
  private abortController: AbortController = new AbortController();
  private _cancelled = false;

  get cancelled(): boolean {
    return this._cancelled;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  // Lifecycle
  show(title: string): void {
    this.overlay?.remove();
    this._cancelled = false;
    this.abortController = new AbortController();

    const overlay = document.createElement('div');
    overlay.className = 'ytms-overlay';
    overlay.id = 'ytms-progress-overlay';
    overlay.innerHTML = `
      <div class="ytms-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="ytms-modal-head">
          <div class="ytms-modal-icon-wrap">
            <img 
              src="${chrome.runtime.getURL('icons/icon128.png')}" 
              alt="True Shuffle Logo" 
              class="ytms-modal-logo" 
            />
          </div>
          <div>
            <div class="ytms-modal-title">${title}</div>
            <div class="ytms-modal-sub">YouTube Music Permanently Shuffle</div>
          </div>
        </div>
        <div class="ytms-modal-body">
          <div class="ytms-status" id="ytms-status">Initialising…</div>
          <div class="ytms-bar-track">
            <div class="ytms-bar-fill ytms-indeterminate" id="ytms-bar"></div>
          </div>
          <div class="ytms-progress-label" id="ytms-progress-label"></div>
        </div>
        <div class="ytms-modal-foot">
          <button class="ytms-btn-ghost" id="ytms-cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    overlay.querySelector('#ytms-cancel-btn')?.addEventListener('click', () => {
      this.handleCancel();
    });
  }

  update(opts: ModalUpdateOptions): void {
    if (!this.overlay) return;

    if (opts.status !== undefined) {
      const el = this.overlay.querySelector('#ytms-status');
      if (el) el.textContent = opts.status;
    }

    if (opts.progress !== undefined) {
      const bar = this.overlay.querySelector('#ytms-bar') as HTMLElement | null;
      if (bar) {
        bar.classList.remove('ytms-indeterminate');
        bar.style.width = `${Math.min(100, Math.max(0, opts.progress))}%`;
      }
    }

    if (opts.progressLabel !== undefined) {
      const lbl = this.overlay.querySelector('#ytms-progress-label');
      if (lbl) lbl.textContent = opts.progressLabel;
    }

    if (opts.canClose) {
      const btn = this.overlay.querySelector('#ytms-cancel-btn') as HTMLButtonElement | null;
      if (btn) btn.textContent = 'Close';
    }
  }

  showSuccess(
    message: string,
    opts: {
      onClose?: () => void;
      onRestore?: (() => void) | null;
    } = {}
  ): void {
    this.replaceBody(`
      <div class="ytms-result">
        <div class="ytms-result-icon ytms-success">${ICONS.check}</div>
        <div class="ytms-result-title">Shuffle complete!</div>
        <div class="ytms-result-msg">${this.esc(message)}</div>
      </div>
    `);

    this.replaceFooter(`
      ${opts.onRestore ? `<button class="ytms-btn-danger-ghost" id="ytms-restore-btn">${ICONS.restore} Restore original</button>` : ''}
      <button class="ytms-btn-solid" id="ytms-done-btn">Done</button>
    `);

    this.overlay?.querySelector('#ytms-done-btn')?.addEventListener('click', () => {
      this.hide();
      opts.onClose?.();
    });

    if (opts.onRestore) {
      this.overlay?.querySelector('#ytms-restore-btn')?.addEventListener('click', () => {
        this.hide();
        opts.onRestore?.();
      });
    }
  }

  showError(message: string, onClose?: () => void): void {
    this.replaceBody(`
      <div class="ytms-result">
        <div class="ytms-result-icon ytms-error">${ICONS.error}</div>
        <div class="ytms-result-title">Shuffle failed</div>
        <div class="ytms-result-msg">${this.esc(message)}</div>
      </div>
    `);

    this.replaceFooter(`
      <button class="ytms-btn-solid" id="ytms-close-btn">Close</button>
    `);

    this.overlay?.querySelector('#ytms-close-btn')?.addEventListener('click', () => {
      this.hide();
      onClose?.();
    });
  }

  hide(): void {
    if (!this.overlay) return;
    this.overlay.style.animation = 'ytms-fade-out 0.15s ease forwards';
    setTimeout(() => {
      this.overlay?.remove();
      this.overlay = null;
    }, 160);
  }

  // Static helpers

  static toast(
    message: string,
    type: 'info' | 'success' | 'error' = 'info',
    durationMs = 4000
  ): void {
    document.querySelector('.ytms-toast')?.remove();

    const toast = document.createElement('div');
    toast.className = `ytms-toast ${type !== 'info' ? `ytms-toast-${type}` : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'ytms-toast-out 0.25s ease forwards';
      setTimeout(() => toast.remove(), 270);
    }, durationMs);
  }

  private handleCancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this.abortController.abort();

    const btn = this.overlay?.querySelector('#ytms-cancel-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = 'Cancelling…';
      btn.disabled = true;
    }
  }

  private replaceBody(html: string): void {
    const body = this.overlay?.querySelector('.ytms-modal-body');
    if (body) body.innerHTML = html;
  }

  private replaceFooter(html: string): void {
    const foot = this.overlay?.querySelector('.ytms-modal-foot');
    if (foot) foot.innerHTML = html;
  }

  private esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }
}
