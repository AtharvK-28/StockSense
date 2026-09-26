/**
 * Small in-memory sliding-window limiter for failed attempts (e.g. logins). Good enough for a
 * single-process deployment; swap for a shared store if the API is ever scaled horizontally.
 */
export function failureLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const failures = new Map<string, number[]>();

  const recent = (key: string) => {
    const cutoff = Date.now() - windowMs;
    const hits = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (hits.length) failures.set(key, hits);
    else failures.delete(key);
    return hits;
  };

  return {
    /** Milliseconds until the key may try again, or 0 if it isn't locked. */
    retryAfter(key: string) {
      const hits = recent(key);
      return hits.length >= max ? hits[0]! + windowMs - Date.now() : 0;
    },
    fail(key: string) {
      failures.set(key, [...recent(key), Date.now()]);
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}
