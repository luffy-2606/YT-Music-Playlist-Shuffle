import { logger } from './logger';

// ─────────────────────────────────────────────
// Async helpers
// ─────────────────────────────────────────────

/** Pause execution for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 *
 * @param fn           - The async function to retry
 * @param maxAttempts  - Maximum number of attempts (default 3)
 * @param baseDelayMs  - Initial delay between retries in ms (doubles each attempt)
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`
      );

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.debug(`Retrying in ${delay}ms…`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ─────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────

/**
 * Wait for a CSS-selector match inside `root`, up to `timeoutMs`.
 * Resolves immediately if the element already exists.
 */
export function waitForElement(
  selector: string,
  timeoutMs: number = 10_000,
  root: Element | Document = document
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const existing = root.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver((_mutations, obs) => {
      const el = root.querySelector(selector);
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    const observeTarget =
      root instanceof Document ? (root.body ?? root.documentElement) : root;

    observer.observe(observeTarget, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`[waitForElement] Timeout after ${timeoutMs}ms: ${selector}`));
    }, timeoutMs);
  });
}

/**
 * Convenience: try multiple selectors in order, return the first match.
 * Waits up to `timeoutMs` for each.
 */
export async function waitForFirstElement(
  selectors: string[],
  timeoutMs: number = 5_000
): Promise<{ el: Element; selector: string } | null> {
  for (const selector of selectors) {
    try {
      const el = await waitForElement(selector, timeoutMs);
      return { el, selector };
    } catch {
      // try next
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Cookie helpers
// ─────────────────────────────────────────────

/**
 * Read a cookie value by name from document.cookie.
 * Returns `null` when not found or not accessible.
 */
export function getCookieValue(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

/**
 * Return the first available auth cookie value.
 * YouTube Music uses SAPISID (and its Secure variant __Secure-3PAPISID).
 */
export function getSapisid(): string | null {
  // Prefer the secure variant when available
  return (
    getCookieValue('__Secure-3PAPISID') ??
    getCookieValue('SAPISID') ??
    null
  );
}

// ─────────────────────────────────────────────
// URL / routing helpers
// ─────────────────────────────────────────────

/**
 * Returns true when the current page is a YouTube Music playlist page.
 * Does NOT activate on albums, artist pages, or watch pages.
 */
export function isPlaylistPage(): boolean {
  return (
    window.location.hostname === 'music.youtube.com' &&
    window.location.pathname === '/playlist' &&
    !!new URLSearchParams(window.location.search).get('list')
  );
}

/**
 * Extract the playlist ID from the current URL.
 * Returns null if not on a playlist page.
 */
export function getPlaylistIdFromUrl(): string | null {
  if (!isPlaylistPage()) return null;
  return new URLSearchParams(window.location.search).get('list');
}

// ─────────────────────────────────────────────
// Safe JSON
// ─────────────────────────────────────────────

/** JSON.parse that returns null on failure instead of throwing. */
export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Chunking
// ─────────────────────────────────────────────

/** Split an array into chunks of at most `size` elements. */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
