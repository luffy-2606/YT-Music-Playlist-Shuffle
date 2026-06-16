/**
 * Cryptographic utilities for YouTube Music API authentication.
 *
 * YouTube (and YouTube Music) uses SAPISIDHASH for authenticated API calls.
 * Format: SAPISIDHASH <timestamp>_<SHA1(timestamp + " " + SAPISID + " " + origin)>
 */

/* Compute a SHA-1 hex digest of a UTF-8 string */
export async function sha1Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a SAPISIDHASH Authorization header value.
 *
 * @param sapisid  - SAPISID cookie
 * @param origin   - The page origin
 */
export async function generateSAPIHASH(
  sapisid: string,
  origin: string = 'https://music.youtube.com'
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const preimage = `${timestamp} ${sapisid} ${origin}`;
  const hash = await sha1Hex(preimage);
  return `SAPISIDHASH ${timestamp}_${hash}`;
}
