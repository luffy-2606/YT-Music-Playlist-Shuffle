/**
 * Cryptographic utilities for YouTube Music API authentication.
 *
 * YouTube (and YouTube Music) uses SAPISIDHASH for authenticated API calls.
 * Format: SAPISIDHASH <timestamp>_<SHA1(timestamp + " " + SAPISID + " " + origin)>
 *
 * Reference: https://stackoverflow.com/questions/64983087 (public documentation)
 */

/**
 * Compute a SHA-1 hex digest of a UTF-8 string using the Web Crypto API.
 */
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
 * @param sapisid  - Value of the SAPISID cookie
 * @param origin   - The page origin (https://music.youtube.com)
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
