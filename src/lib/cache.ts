/**
 * Last-seen data, kept on this device so a screen can draw straight away from
 * what it showed last time while the fresh copy loads (stale-while-revalidate).
 * Everything still comes from the database; this only removes the blank
 * moment. Cleared on sign-out so the next person on the device sees nothing.
 */
const PREFIX = "sl:";

export function readCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch { return undefined; }
}

export function writeCache(key: string, value: unknown): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked: just skip */ }
}

export function clearCache(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch { /* nothing to clear */ }
}
