import type { Entry } from "@/lib/queries";

export function EntrySwitcher({ entries, current, path }: {
  entries: Entry[]; current: Entry; path: string;
}) {
  if (entries.length < 2) return null;
  return (
    <div className="rounds">
      {entries.map((e) => (
        <a key={e.id} href={`${path}?entry=${e.id}`} className={e.id === current.id ? "on" : ""}>
          {e.team_name}
        </a>
      ))}
    </div>
  );
}
