import { logger } from './logger';

export type NavigationCallback = (url: string, prevUrl: string) => void;

/**
 * Detects client-side navigation in YouTube Music (SPA).
 *
 * YouTube Music uses the History API (pushState / replaceState) for routing.
 * The content script is NOT re-injected on navigation — we must detect it here.
 *
 * Strategy:
 *   1. Patch history.pushState and history.replaceState (most reliable)
 *   2. Listen for `popstate` (back/forward buttons)
 *   3. Poll as a safety net for edge cases (navigation that bypasses patched methods)
 */
export class NavigationDetector {
  private callbacks: NavigationCallback[] = [];
  private lastUrl: string;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private originalPushState: typeof history.pushState;
  private originalReplaceState: typeof history.replaceState;

  constructor() {
    this.lastUrl = window.location.href;
    this.originalPushState = history.pushState.bind(history);
    this.originalReplaceState = history.replaceState.bind(history);

    this.patchHistoryMethods();
    this.listenForPopState();
    this.startPolling();

    logger.debug(`NavigationDetector initialised. Current URL: ${this.lastUrl}`);
  }

  /** Register a callback that fires on every URL change. Returns an unsubscribe fn. */
  onNavigate(callback: NavigationCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  destroy(): void {
    // Restore original methods
    history.pushState = this.originalPushState;
    history.replaceState = this.originalReplaceState;

    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.callbacks = [];
  }

  // ─── Private ──────────────────────────────────────────

  private notify(newUrl: string): void {
    if (newUrl === this.lastUrl) return;
    const prev = this.lastUrl;
    this.lastUrl = newUrl;
    logger.debug(`Navigation: ${prev} → ${newUrl}`);
    for (const cb of this.callbacks) {
      try {
        cb(newUrl, prev);
      } catch (err) {
        logger.error('NavigationDetector callback error', err);
      }
    }
  }

  private patchHistoryMethods(): void {
    const self = this;

    history.pushState = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      self.originalPushState.call(this, data, unused, url);
      self.notify(window.location.href);
    };

    history.replaceState = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) {
      self.originalReplaceState.call(this, data, unused, url);
      self.notify(window.location.href);
    };
  }

  private listenForPopState(): void {
    window.addEventListener('popstate', () => {
      this.notify(window.location.href);
    });
  }

  private startPolling(): void {
    // 750ms poll — low-cost safety net
    this.pollInterval = setInterval(() => {
      this.notify(window.location.href);
    }, 750);
  }
}
