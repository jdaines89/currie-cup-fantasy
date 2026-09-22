import { listEntries, type Entry } from "./queries";

/** The entry a page is acting on: ?entry=<id>, else the first one. */
export function resolveEntry(entryParam?: string): { entry: Entry | null; all: Entry[] } {
  const all = listEntries();
  if (all.length === 0) return { entry: null, all };
  const wanted = all.find((e) => String(e.id) === entryParam);
  return { entry: wanted ?? all[0], all };
}
