# Supabase: the shared league

The database behind the invite-only league. Four layers, each built only from
the one before it:

| Layer | Where | What | Who writes it |
|---|---|---|---|
| raw | `raw.feed_payloads` | Every feed response, verbatim, append-only, deduplicated by hash | Ingest (pg_cron + pg_net) |
| core | `seasons`, `teams`, `matches`, `players`, `player_match_stats`, `season_bonus_points` | Clean typed rows, each traceable to its raw payload (`matches.raw_id`) | `core_load_events()` from raw |
| league | `members`, `entries`, `predictions` (with `is_banker`), `pool_picks` (retired, unread), `squad_picks`, `round_locks` | What members do | Members, own rows only |
| marts | `standings`, `prediction_scores`, `leaderboard` | Views, never stale, no rescore job | Nobody: computed |

**Access.** Invite-only. Sending an invite from Supabase (Authentication >
Users > Invite user) creates the account, and a trigger makes it a member.
Public sign-up is switched off. Row-level security on every table: anyone not
signed in, or signed in without an invite, sees nothing; members read the
whole league and write only their own entry and picks. Reference data changes
only through the ingest job's service role.

**Rules in the database, not the app.** Four unions a round, one captain,
picks lock at the first kickoff (or, for a replay season like 2026, when the
member locks the round in, which can't be undone), and scores stay hidden
until a round is locked.

**Live results.** The database fetches them itself, and only when something
can have changed. Every 15 minutes pg_cron runs `raw.request_rounds()`, which
asks TheSportsDB (through pg_net) for just the rounds of a live, non-replay
season with a match that kicked off in the last six hours or has kicked off
with no score yet. Once a day at 03:00 UTC it asks for every round, to catch
moved fixtures. Two minutes after each request `raw.collect_responses()` lands
the answers in `raw.feed_payloads` and calls `core_load_events()`. On days with
no rugby it makes no calls at all. No server and no secrets. First live run,
2026-09-23: 7 rounds landed, all 28 events agreed with the seeded results,
0 changes.

**Tests.** `sh supabase/tests/run.sh` rebuilds a scratch database on a local
Postgres 16 from the migrations and seed, with a small stand-in for Supabase's
auth schema, and runs 24 behaviour checks: access for strangers, self-registered accounts, members and
other members, the pick rules, scoring against the app's rules, the log
against the published 2026 table, and the ingest transform's idempotency.

**Seed.** `npx tsx scripts/supabase-seed.ts` regenerates `seed.sql` from
`data/seed/currie-cup-2026.json`.
