/**
 * Fisher-Yates (Knuth) shuffle — the gold standard for unbiased permutations.
 *
 * This implementation uses crypto.getRandomValues() for a cryptographically
 * strong random source, avoiding the modulo bias present in Math.random().
 *
 * Time:  O(n)
 * Space: O(n)  (returns a copy; original is not mutated)
 */
export function fisherYatesShuffle<T>(array: readonly T[]): T[] {
  const arr = [...array]; // defensive copy

  for (let i = arr.length - 1; i > 0; i--) {
    // Rejection-sample to eliminate modulo bias.
    // For small arrays (< 2^32) a single 32-bit random value is sufficient.
    const range = i + 1;
    const max = Math.floor(0x1_0000_0000 / range) * range;

    let r: number;
    const buf = new Uint32Array(1);
    do {
      crypto.getRandomValues(buf);
      r = buf[0]!;
    } while (r >= max);

    const j = r % range;

    // Swap
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }

  return arr;
}

/**
 * Verify that the shuffle actually produced a different order.
 * For large playlists the probability of an identical permutation is negligible,
 * but we check anyway and re-shuffle once if unlucky.
 */
export function shuffleAndVerify<T extends { setVideoId: string }>(
  tracks: T[]
): T[] {
  if (tracks.length <= 1) return [...tracks];

  let result = fisherYatesShuffle(tracks);

  // Re-shuffle if first AND last element are unchanged (extremely rare,
  // but worth guarding against for very short playlists)
  if (
    tracks.length >= 3 &&
    result[0]?.setVideoId === tracks[0]?.setVideoId &&
    result[result.length - 1]?.setVideoId === tracks[tracks.length - 1]?.setVideoId
  ) {
    result = fisherYatesShuffle(result);
  }

  return result;
}
