# Currie Cup Fantasy

Fantasy rugby for the Currie Cup, running on free data. No API key, no account,
no subscription, no card.

Two games share one database:

- **Union Pool** — pick four of the eight unions each round and nominate a
  captain. It scores itself from real match results, so it needs nothing from
  you but the picks.
- **Player Squad** — a salary-capped nineteen (fifteen starters, four on the
  bench) picked from real union rosters, scored on per-player match numbers.

## Running it

```bash
npm install
npm run setup     # create the database, load the 2026 season, score it
npm run dev       # http://localhost:3000
```

`npm run setup` loads a committed snapshot, so a fresh clone works offline. To
refresh from the live feed:

```bash
npm run ingest            # every round of the current season
npm run ingest -- 8 9     # just those rounds
npm run score             # recompute points from the new results
```

## Where the data comes from

The honest picture, because it shaped every decision here.

| Source | Currie Cup coverage | Verdict |
|---|---|---|
| **TheSportsDB** free tier | 8 unions, fixtures and results, 2025 and 2026 | **In use.** No key, no signup, no cost. |
| ESPN's free API | League exists but stops at 2022 | Unusable — stale. |
| API-Sports rugby | Fixtures, results, standings — **no players endpoint at all** | Adapter included, but it can never feed the player game. |
| Opta / Sportradar | Everything | Paid. |

TheSportsDB is league `5069`. Its free key is the documented public test key
`3`, which needs no account. The season endpoint truncates on the free tier, so
`scripts/ingest.ts` walks round by round instead; eight unions means four
matches a round.

The committed snapshot in `data/seed/currie-cup-2026.json` is the full 2026
regular season, 28 matches across 7 rounds. Every union's won/drawn/lost derived
from it matches the published log, and `tests/scoring.test.ts` asserts exactly
that, so a bad ingest fails the test rather than quietly skewing the league.

### The gap: player stats

**No free source anywhere carries Currie Cup player-level match statistics.**
TheSportsDB returns null for lineups, timelines and player lists on these teams;
API-Sports has no players endpoint for rugby at all; Wikipedia has no squads for
most unions. This is not an oversight in the app — it is the state of free rugby
data for this competition.

So the player game gets its numbers two ways:

```bash
npm run import:stats -- stats/round-7.csv    # a whole round at once
```

or on the **Admin** screen, a match at a time. Either way the leaderboard
updates the moment they land.

The Union Pool needs none of this. That is why it exists: it is the mode that
scores itself, on real results, with no manual work at all.

Rosters are in the same boat — see [`squads/README.md`](squads/README.md).
Three of the eight unions ship with real squads (115 players); the rest publish
theirs behind bot checks and need a CSV.

## Replay mode

The 2026 season finished on 30 August. Rather than show a league nobody can
enter, the app notices that every match in the database has been played and
opens picks on all rounds, so you play the season back and see what your calls
would have earned. Ingest a live round and picks lock at kickoff again.

## Scoring

**Union Pool**, per union picked:

| | |
|---|---|
| Win / draw | 10 / 5 |
| Every 5 points scored | +1 |
| Every 10 points conceded | −1 |
| Winning by 15+ | +5 |
| Losing by 7 or less | +3 |
| Captain | ×2 |

**Player Squad**, per starter (the bench never scores):

| | |
|---|---|
| Took the field / 40+ minutes | 1 / +2 |
| Try / try assist | 5 / 3 |
| Conversion | 2 |
| Penalty / drop goal | 3 / 3 |
| Turnover won | 2 |
| Tackle / carry | 0.1 each |
| Metre carried | 0.02 |
| Team won | +2 |
| Yellow / red card | −2 / −5 |
| Captain | ×2 |

Cap is 100 credits for nineteen players. Prices come from position and how the
union is actually going on the log, since there are no stats to value players
on; they move when you re-seed after an ingest.

## The log

Won, drawn, lost, points for/against/difference, and now the points column
too are all exact for the 2026 season. The real Currie Cup awards a bonus
point for scoring four or more tries in a match, on top of 4 for a win and 2
for a draw, and no free feed publishes try counts here to compute that from
(checked directly against TheSportsDB's own event lookup, which returns
nothing past the final score). Rather than guess at it, `season_bonus_points`
in the schema carries the real total bonus points per union for the whole
finished season, read off the published final standings at
[Wikipedia's 2026 Currie Cup Premier Division page](https://en.wikipedia.org/wiki/2026_Currie_Cup_Premier_Division)
on 2026-09-22 and spot-checked against SuperSport's own table (see
`data/seed/currie-cup-2026.json`'s `published_final_bonus_points`). It is a
season-level fact about a finished competition, not something derived from
the match results above.

This only works for a season that has already finished and been checked
against a published table. A season still in progress has no row here, and
`buildLog` falls back to exact win/draw/losing-bonus math -- which leaves out
the try bonus and so runs a few points below the real total -- ranked on
match points from wins and draws rather than the partial points column. The
UI marks the difference: the points column drops its asterisk once every row
has the real total.

Two bugs preceded this, both fixed 2026-09-22 after a discrepancy against
SuperSport's table: the points column had guessed at the try bonus from
total points scored, undercounting every team by one to four points, and the
ranking had sorted on win count alone, ignoring draws, which put at least one
side above a team that actually finished ahead of it.

## Layout

```
src/lib/
  schema.sql        every table, with comments on why each exists
  providers/        DataProvider interface + TheSportsDB and API-Sports adapters
  scoring.ts        both scoring engines, pure functions, fully tested
  standings.ts      the log, built from results
  pricing.ts        player prices from position and union form
  recompute.ts      rescores an entry; called on every save and by `npm run score`
scripts/            seed, ingest, imports, scoring
data/seed/          the committed real snapshot
tests/              scoring and log, checked against the published table
```

Swapping the data source means implementing `DataProvider` (two methods) and
adding a case to `src/lib/providers/index.ts`. Nothing else knows where
fixtures come from.

## Commands

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest |
| `npm run typecheck` | tsc |
| `npm run setup` | reset + seed + score |
| `npm run ingest` | pull fixtures and results from the live feed |
| `npm run import:roster -- f.csv` | load a squad |
| `npm run import:stats -- f.csv` | load per-player match numbers |
| `npm run score` | recompute every entry |

Next.js 15, TypeScript, SQLite via better-sqlite3. Plain SQL, no ORM.

## Team colours and logos

`src/lib/team-brand.ts` holds each union's jersey colour and its official badge
(hotlinked from TheSportsDB, never stored in the repo). The app shows the badges
by default; set `SHOW_OFFICIAL_LOGOS=0` to use jersey-colour discs instead. The
badges are the unions' trademarks, so keep them to internal use until they are
licensed. The public demo in `docs/` only ever shows the coloured discs.
