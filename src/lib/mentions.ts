/**
 * Chat tags. On screen a tag reads "@Andy"; in the database it is stored as
 * <@user_id>, so it survives a rename and the database can tell who was
 * tagged (see supabase/migrations/..._chat.sql).
 */

export interface Person { user_id: string; display_name: string }

const TAG = /<@([0-9a-f-]{36})>/g;

/** "@Andy nice one" -> "<@uuid> nice one". Longest names first, so "@Andy B" wins over "@Andy". */
export function encodeMentions(text: string, people: Person[]): string {
  const byLength = [...people].sort((a, b) => b.display_name.length - a.display_name.length);
  let out = text;
  for (const p of byLength) {
    const esc = p.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`@${esc}(?![\\p{L}\\p{N}_])`, "giu"), `<@${p.user_id}>`);
  }
  return out;
}

export type Part = { text: string } | { userId: string };

/** Splits a stored body into text and tags, for drawing. */
export function splitMentions(body: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of body.matchAll(TAG)) {
    if (m.index! > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ userId: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** The "@Chr" being typed at the end of the text, if any. */
export function typingTag(beforeCursor: string): string | null {
  const m = /(?:^|\s)@([\p{L}\p{N}_ ]{0,20})$/u.exec(beforeCursor);
  return m && !m[1].includes("  ") ? m[1] : null;
}
