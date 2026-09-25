/**
 * The round at a glance: which of this round's games will move the table
 * between you and your mates, and where you stand going into them. Built only
 * from calls you can already see (the database hides mates' calls until both
 * are locked), so it never gives anything away.
 */

export interface DigestCall { entry_id: number; match_id: string; home_score: number; away_score: number; is_banker: boolean }
export interface DigestMate extends DigestCall { name: string }
export interface DigestMatch { id: string; home: string; away: string; finished: boolean }
export interface DigestRow { entry_id: number | null; manager: string; total_points: number }

export interface SwingGame {
  match_id: string;
  title: string;          // "Lions v Sharks"
  text: string;           // one sentence on where you split
  tags: string[];         // "Your Banker", "Reeves' Banker"
  weight: number;         // for ordering only
}

export interface Digest {
  swings: SwingGame[];
  agreed: number;         // games where every mate called the same winner as you
  standing: string | null;
  rival: string | null;
}

const sign = (c: { home_score: number; away_score: number }) => Math.sign(c.home_score - c.away_score);
const pick = (c: { home_score: number; away_score: number }, m: DigestMatch) =>
  sign(c) > 0 ? m.home : sign(c) < 0 ? m.away : "a draw";
const by = (c: { home_score: number; away_score: number }) => Math.abs(c.home_score - c.away_score);
const names = (xs: string[]) => xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`;
const poss = (n: string) => (n.endsWith("s") ? `${n}'` : `${n}'s`);
const ord = (n: number) => {
  const t = n % 100, u = n % 10;
  return `${n}${t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`;
};
const backs = (c: DigestCall, m: DigestMatch) => sign(c) === 0 ? "a draw" : `${pick(c, m)} by ${by(c)}`;

/** Roughly how many points could open up between two calls: a different
 *  winner is worth the 6 for the result plus the 5 for the margin, the same
 *  winner only the margin. A Banker on either side doubles it. */
function gap(me: DigestCall, them: DigestCall) {
  const base = sign(me) !== sign(them) ? 11 : Math.min(Math.abs(by(me) - by(them)), 10) / 2;
  return base * (1 + (me.is_banker ? 1 : 0) + (them.is_banker ? 1 : 0));
}

export function buildDigest(opts: {
  myEntry: number;
  mine: DigestCall[];
  mates: DigestMate[];
  matches: DigestMatch[];
  table: DigestRow[];     // the pool's leaderboard; empty when you're in no pool
  poolName: string | null;
  top?: number;
}): Digest | null {
  const { myEntry, mine, mates, matches, table, poolName, top = 3 } = opts;
  const games: SwingGame[] = [];
  let agreed = 0;
  for (const m of matches) {
    if (m.finished) continue;
    const me = mine.find((c) => c.match_id === m.id);
    const theirs = mates.filter((c) => c.match_id === m.id);
    if (!me || !theirs.length) continue;
    const against = theirs.filter((c) => sign(c) !== sign(me));
    const tags = [
      ...(me.is_banker ? ["Your Banker"] : []),
      ...theirs.filter((c) => c.is_banker).map((c) => `${poss(c.name)} Banker`),
    ];
    let text: string;
    if (against.length === theirs.length) {
      const other = [...new Set(against.map((c) => pick(c, m)))];
      text = theirs.length === 1
        ? `You've got ${backs(me, m)}, ${theirs[0].name} has ${other[0]}.`
        : `You're on your own with ${backs(me, m)}. ${theirs.length === 2 ? "Both" : `All ${theirs.length}`} mates went ${other.length === 1 ? other[0] : "the other way"}.`;
    } else if (against.length) {
      text = `You've got ${backs(me, m)}. ${names(against.map((c) => c.name))} went the other way.`;
    } else {
      agreed++;
      const bys = theirs.map(by);
      const lo = Math.min(...bys), hi = Math.max(...bys);
      text = sign(me) === 0
        ? "Everyone has a draw, so only the exact score splits you."
        : `Everyone has ${pick(me, m)}. You say by ${by(me)}, ${theirs.length === 1 ? theirs[0].name : "mates"} ${lo === hi ? `by ${lo}` : `by ${lo} to ${hi}`}.`;
    }
    games.push({ match_id: m.id, title: `${m.home} v ${m.away}`, text, tags,
      weight: theirs.reduce((a, c) => a + gap(me, c), 0) / theirs.length + (against.length ? 100 : 0) });
  }
  if (!games.length) return null;
  games.sort((a, b) => b.weight - a.weight);
  // Games everyone agrees on only show when nothing splits you more.
  const swings = games.filter((g) => g.weight >= 100).slice(0, top);
  if (!swings.length) swings.push(...games.slice(0, Math.min(top, 2)));

  let standing: string | null = null, rival: string | null = null;
  const rows = table.filter((r) => r.entry_id !== null);
  const meRow = rows.find((r) => r.entry_id === myEntry);
  if (meRow && rows.length > 1 && poolName) {
    const rank = 1 + rows.filter((r) => r.total_points > meRow.total_points).length;
    const tied = rows.filter((r) => r.entry_id !== myEntry && r.total_points === meRow.total_points);
    const above = rows.filter((r) => r.total_points > meRow.total_points).sort((a, b) => a.total_points - b.total_points)[0];
    const below = rows.filter((r) => r.total_points < meRow.total_points).sort((a, b) => b.total_points - a.total_points)[0];
    const pts = `${meRow.total_points} pt${meRow.total_points === 1 ? "" : "s"}`;
    const target = above ?? tied[0] ?? below;
    if (rank === 1 && !tied.length) standing = `You lead ${poolName} on ${pts}, ${meRow.total_points - below!.total_points} clear of ${below!.manager}.`;
    else if (tied.length && !above) standing = `You're level at the top of ${poolName} on ${pts} with ${names(tied.map((r) => r.manager))}.`;
    else standing = `You're ${ord(rank)} in ${poolName} on ${pts}, ${above!.total_points - meRow.total_points} behind ${above!.manager}.`;
    if (target?.entry_id) {
      const split = games.filter((g) => {
        const me = mine.find((c) => c.match_id === g.match_id)!;
        const them = mates.find((c) => c.match_id === g.match_id && c.entry_id === target.entry_id);
        return them && sign(them) !== sign(me);
      }).length;
      const shared = games.filter((g) => mates.some((c) => c.match_id === g.match_id && c.entry_id === target.entry_id)).length;
      if (shared) rival = split
        ? `You and ${target.manager} split on ${split} of ${shared} game${shared === 1 ? "" : "s"}, so this round could swing it.`
        : `You and ${target.manager} have the same winners in all ${shared === 1 ? "that game" : `${shared} games`}, so margins decide it.`;
    }
  }
  return { swings, agreed, standing, rival };
}
