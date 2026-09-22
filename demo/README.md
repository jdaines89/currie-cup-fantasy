# The phone demo

`currie-cup-pool.html` is the union pool as one self-contained page: no server, no
network, no build step. Open the file in any browser, including on a phone, and it
works. It exists so the game can be shown to someone without running `npm run dev`
on a laptop first.

Published at <https://claude.ai/artifact/S7cNifjjqXg3xD3NZUiwUb> (private until it
is shared from that page's Share menu).

## What it carries

- The same 2026 season as `data/seed/currie-cup-2026.json`: eight unions, 28
  matches over seven rounds, real fixtures and real final scores.
- The Union Pool scoring from `src/lib/scoring.ts` and the log from
  `src/lib/standings.ts`, both ported into plain JavaScript at the bottom of the
  file under comments saying so.

**These are copies, not imports.** A change to the scoring rules or the season
snapshot in the app does not reach this page; it has to be carried across by hand
and the page republished to the URL above. The scoring tables in `tests/` guard
the app, not this file.

## What it leaves out

The player game. No free source carries Currie Cup player-level match stats and
only three of the eight unions have real rosters, so including it here would have
meant inventing players. The page says as much in its footer.

Picks live in the viewer's `localStorage`, so the leaderboard is per-device and
the demo is pass-the-phone: add a name for each person at the top.
