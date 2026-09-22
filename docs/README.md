# The phone demo

`index.html` is the whole demo: no server, no network, no build step. Open it in
any browser, including on a phone, and it works. It exists so the games can be
shown to someone without running `npm run dev` on a laptop first.

It lives in `docs/` and is named `index.html` so **GitHub Pages can serve it as
is**: repository Settings, then Pages, then Deploy from a branch, `main` and the
`/docs` folder. That gives a public URL anyone can open without a Claude account,
which the published Artifact cannot do.

Also published at <https://claude.ai/artifact/S7cNifjjqXg3xD3NZUiwUb>, which only
opens for people who are signed in to Claude and have been given access.

## What it carries

- The same 2026 season as `data/seed/currie-cup-2026.json`: eight unions, 28
  matches over seven rounds, real fixtures and real final scores.
- **Union pool**, the scoring from `src/lib/scoring.ts`: pick four unions a
  round, one as captain.
- **Score predictions**, which the Next.js app does not have: call the score of
  each fixture in the round. 6 for the winner, +5 for the exact margin, +2 for
  each side within three points, +10 for the exact scoreline, so 25 for a perfect
  call. Rules live in the `PRED` object in the page.
- The log from `src/lib/standings.ts`.

**The ported scoring is a copy, not an import.** A change to the rules or the
season snapshot in the app does not reach this page; it has to be carried across
by hand and the page republished.

## What it leaves out

The player game. No free source carries Currie Cup player-level match stats and
only three of the eight unions have real rosters, so including it here would have
meant inventing players.

Picks live in the viewer's `localStorage`, so the leaderboard is per-device and
the demo is pass-the-phone: add a name for each person at the top.
