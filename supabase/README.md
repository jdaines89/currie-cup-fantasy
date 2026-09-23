# Supabase: the shared league

The database behind the invite-only league. Four layers, each built only from
the one before it:

| Layer | Where | What | Who writes it |
|---|---|---|---|
| raw | `raw.feed_payloads` | Every feed response, verbatim, append-only, deduplicated by hash | Ingest (pg_cron + pg_net) |
| core | `competitions`, `seasons`, `teams`, `matches`, `players`, `player_match_stats`, `season_bonus_points` | Clean typed rows, each traceable to its raw payload (`matches.raw_id`) | `core_load_events()` from raw |
| league | `members`, `entries`, `predictions` (with `is_banker`), `pool_picks` (retired, unread), `squad_picks`, `round_locks`, `pools`, `pool_members`, `chat_messages`, `chat_mentions`, `chat_reads` | What members do | Members, own rows only |
| notify | `notify.settings`, `notify.reminders_sent`, `notify.due_reminders()` | Kickoff reminder emails | pg_cron |
| marts | `standings`, `prediction_scores`, `pool_leaderboard`, `chat_unread` | Views, never stale, no rescore job | Nobody: computed |

**Access.** Invite-only. Sending an invite from Supabase (Authentication >
Users > Invite user) creates the account, and a trigger makes it a member.
Public sign-up is switched off. Row-level security on every table: anyone not
signed in, or signed in without an invite, sees nothing; members read the
whole league and write only their own entry and picks. Reference data changes
only through the ingest job's service role.

**Rules in the database, not the app.** One Banker a round; in a live season
each prediction locks at its own match's kickoff (a replay season like 2026
locks a round when the member locks it in, which can't be undone); scores
stay hidden until a round is locked.

**Tournaments and pools.** A competition (Currie Cup, URC) has seasons; a
season names itself the way the feed does (`feed_season`), which is how the
ingest files each match. Members make one entry per season and call each
match once; a pool groups members for one season and is only a leaderboard
and a chat, so the same calls count in every pool you're in. Pools are
private: you see one only once you're in it, and the one way in is its
six-character code (`join_pool()`).

**Chat.** Per pool. A tag is stored as `<@user_id>`, never as a name, so it survives a
rename; a trigger reads tags into `chat_mentions` (members only). Nobody posts
as anyone else or edits a message; you can delete your own. New messages reach
open screens through Supabase Realtime, under the same row-level security.

**Kickoff reminders.** Every five minutes `notify.send_reminders()` emails
anyone with no score for a live match kicking off within the hour: one email
per person through Brevo's API (pg_net), each match recorded in
`notify.reminders_sent` so nobody is reminded twice. Members can switch them
off. The Brevo API key lives in Supabase Vault as `brevo_api_key`, set once in
the SQL editor with `select vault.create_secret('<key>', 'brevo_api_key');`;
without it nothing is sent.

**Live results.** The database fetches them itself, match by match, and only
when something can have changed. TheSportsDB's free key caps a round request
at five matches, but `lookupevent.php` answers for any match and a season's
match ids run in sequence. Every 15 minutes pg_cron runs `raw.request_live()`
for matches in play or overdue a score; once a day at 03:00 UTC it adds the
coming week's matches (moved kickoffs) and the next ten ids after each live
season's last match (new fixtures). `raw.request_event_ids()` backfills a new
season. Two minutes after each request `raw.collect_responses()` lands
the answers in `raw.feed_payloads` and calls `core_load_events()`. On days with
no rugby it makes no calls at all. No server and no secrets. First live run,
2026-09-23: 7 rounds landed, all 28 events agreed with the seeded results,
0 changes.

**Tests.** `sh supabase/tests/run.sh` rebuilds a scratch database on a local
Postgres 16 from the migrations and seed, with a small stand-in for Supabase's
auth schema, and runs the behaviour checks: access for strangers, self-registered accounts, members and
other members, the pick rules, chat access and tags, who gets a reminder, scoring against the app's rules, the log
against the published 2026 table, and the ingest transform's idempotency.

**Seed.** `npx tsx scripts/supabase-seed.ts` regenerates `seed.sql` from
`data/seed/currie-cup-2026.json`.
