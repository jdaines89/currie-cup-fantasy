-- Behaviour tests for the league: run after the migrations and seed.
-- Every check raises on failure, so a clean run prints "ALL CHECKS PASSED".
\set ON_ERROR_STOP on

-- Two invited members and one stranger who was never invited.
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'justin@example.com', now(), '{"display_name":"Justin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'andy@example.com', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000ff', 'stranger@example.com', null, '{}');  -- signed up without an invite
select 'members created by the invite trigger: ' || count(*) from public.members;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

create function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', false);
    perform set_config('request.jwt.claim.sub', '', false);
  else
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claim.sub', uid, false);
  end if;
end $$;

-- Data landed
select pg_temp.check((select count(*) from public.matches) = 28, 'seed: 28 matches');
select pg_temp.check((select count(*) from public.teams where badge_url is not null) = 8, 'seed: 8 badges');

-- The log matches the published 2026 table exactly
select pg_temp.check(
  (select string_agg(t.short_name || ':' || s.log_points, ' ' order by s.position)
     from public.standings s join public.teams t on t.id = s.team_id where s.season = '2026')
  = 'GRQ:31 CHE:27 PUM:22 LIO:20 SHK:18 BOL:16 WP:16 BUL:6',
  'standings match the published 2026 table');

-- Not signed in: sees nothing
select pg_temp.as_user(null);
do $$ begin
  perform 1 from public.matches limit 1;
  raise exception 'FAILED: anon could read matches';
exception when insufficient_privilege then raise notice 'ok: anon cannot read matches';
end $$;
reset role;

select pg_temp.check((select count(*) from public.members) = 2, 'only invited accounts become members');

-- Signed in but never invited: sees nothing, can't make an entry
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.matches) = 0, 'uninvited user sees no matches');
do $$ begin
  insert into public.entries (season, team_name) values ('2026', 'Gatecrashers');
  raise exception 'FAILED: uninvited user made an entry';
exception when insufficient_privilege then raise notice 'ok: uninvited user cannot make an entry';
end $$;
reset role;

-- Justin: reads the league, makes an entry, picks four unions
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.matches) = 28, 'member sees all matches');
insert into public.entries (season, team_name) values ('2026', 'Daines XV');
insert into public.pool_picks (entry_id, season, round, team_id, is_captain)
select e.id, '2026', 1, t, t = '142073' from public.entries e,
  unnest(array['142073','142075','142067','142063']) t where e.team_name = 'Daines XV';
do $$ begin
  insert into public.pool_picks (entry_id, season, round, team_id)
  select id, '2026', 1, '142072' from public.entries where team_name = 'Daines XV';
  raise exception 'FAILED: fifth pick allowed';
exception when raise_exception then raise notice 'ok: a fifth pick is refused';
end $$;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, '2498543', 24, 26 from public.entries where team_name = 'Daines XV';
insert into public.predictions (entry_id, match_id, home_score, away_score, is_banker)
select id, '2498544', 20, 10, true from public.entries where team_name = 'Daines XV';
update public.predictions set is_banker = true where match_id = '2498543';
select pg_temp.check((select string_agg(match_id, ',') from public.predictions where is_banker) = '2498543',
  'backing a second match moves the Banker, one a round');
select pg_temp.check((select count(*) from public.pool_pick_scores) = 0, 'no score shows before the round is locked in');
insert into public.round_locks (entry_id, season, round)
select id, '2026', 1 from public.entries where team_name = 'Daines XV';
select pg_temp.check((select count(*) from public.pool_pick_scores) = 4, 'scores show once locked in');
do $$ begin
  delete from public.pool_picks where team_id = '142073';
  raise exception 'FAILED: changed a locked round';
exception when raise_exception then raise notice 'ok: a locked round cannot change';
end $$;
select pg_temp.check((select count(*) from public.round_locks) = 1, 'lock row exists');
do $$ begin
  delete from public.round_locks;
  raise exception 'FAILED: undid a lock';
exception when insufficient_privilege then raise notice 'ok: a lock cannot be undone';
end $$;
do $$ begin
  update public.matches set home_score = 99;
  raise exception 'FAILED: member edited a result';
exception when insufficient_privilege then raise notice 'ok: members cannot edit results';
end $$;
reset role;

-- Andy: sees Justin's entry on the leaderboard, cannot touch his picks
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.leaderboard where team_name = 'Daines XV') = 1, 'Andy sees Justin on the leaderboard');
delete from public.pool_picks;
update public.predictions set home_score = 0;
reset role;
select pg_temp.check((select count(*) from public.pool_picks) = 4, 'Andy could not delete Justin''s picks');
select pg_temp.check((select home_score from public.predictions where match_id = '2498543') = 24, 'Andy could not change Justin''s prediction');

-- Scoring matches the app's rules (Sharks won 26-24 away at Pumas in R1, captain)
select pg_temp.check((select total_pts from public.pool_pick_scores where team_id = '142073') = (10 + 5 - 2) * 2,
  'captain Sharks score (10 win + 5 attack - 2 defence) x2 = 26');
select pg_temp.check((select total_pts from public.prediction_scores where match_id = '2498543') = (6 + 5 + 2 + 2 + 5) * 2,
  'exact prediction on the Banker scores 20 x2 = 40');
select pg_temp.check((select total_pts from public.prediction_scores where match_id = '2498544') = 6,
  'right result only scores 6');
select pg_temp.check((select total_points from public.leaderboard where team_name = 'Daines XV') = 46,
  'leaderboard totals predictions only');

-- The ingest transform: a TheSportsDB round payload lands in core, idempotently
insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'eventsround.php', '{"r":1}',
  '{"events":[{"idEvent":"2498543","strSeason":"2026","intRound":"1","dateEvent":"2026-07-17","strTime":"14:00:00",
    "idHomeTeam":"142072","idAwayTeam":"142073","intHomeScore":"24","intAwayScore":"27","strVenue":"Mbombela Stadium","strStatus":"FT"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a changed score updates core');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 0, 'rerunning the same payload changes nothing');
select pg_temp.check((select away_score from public.matches where id = '2498543') = 27, 'core carries the new score');

-- Supabase's invite inserts the user, then stamps invited_at in an update
reset role;
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000c', 'christo@example.com', null, '{}');
update auth.users set invited_at = now() where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check(exists (select 1 from public.members where user_id = '00000000-0000-0000-0000-00000000000c'),
  'an invite stamped after the insert still makes a member');

-- Chat: members talk, tags are read out, nobody posts as someone else
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.chat_messages (body) values
  ('<@00000000-0000-0000-0000-00000000000b> looks like you''re taking this round. <@00000000-0000-0000-0000-0000000000ff>?');
select pg_temp.check((select count(*) from public.chat_mentions) = 1, 'a tag for a member is recorded, a tag for a stranger is not');
select pg_temp.check((select user_id::text from public.chat_mentions) = '00000000-0000-0000-0000-00000000000b', 'the tag points at Andy');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.chat_messages) = 1, 'Andy reads the chat');
do $$ begin
  insert into public.chat_messages (author_id, body) values ('00000000-0000-0000-0000-00000000000a', 'I am Justin');
  raise exception 'FAILED: posted as someone else';
exception when insufficient_privilege then raise notice 'ok: nobody posts as someone else';
end $$;
delete from public.chat_messages;
do $$ begin
  update public.chat_messages set body = 'edited';
  raise exception 'FAILED: edited a message';
exception when insufficient_privilege then raise notice 'ok: messages cannot be edited';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.chat_messages) = 0, 'a stranger reads no chat');
do $$ begin
  insert into public.chat_messages (body) values ('let me in');
  raise exception 'FAILED: stranger posted';
exception when insufficient_privilege then raise notice 'ok: a stranger cannot post';
end $$;
reset role;
select pg_temp.check((select count(*) from public.chat_messages) = 1, 'Andy could not delete Justin''s message');

-- Kickoff reminders, on a live season: one match started, one in 30 minutes
insert into public.seasons (id, name, is_replay) values ('2027', 'Currie Cup 2027', false);
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source) values
  ('t-started', '2027', 1, now() - interval '1 minute', '142072', '142073', 'SCHEDULED', 'test'),
  ('t-soon',    '2027', 1, now() + interval '30 minutes', '142075', '142070', 'SCHEDULED', 'test'),
  ('t-later',   '2027', 1, now() + interval '3 hours', '142067', '142068', 'SCHEDULED', 'test');
select pg_temp.check((select count(*) from notify.due_reminders()) = 3, 'three members have no score for the match in 30 minutes');
select pg_temp.check((select bool_and(match_ids = array['t-soon']) from notify.due_reminders()), 'only the match inside the hour is in the reminder');
insert into public.entries (user_id, season, team_name) values ('00000000-0000-0000-0000-00000000000a', '2027', 'Daines XV');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-soon', 20, 18 from public.entries where season = '2027';
do $$ begin
  insert into public.predictions (entry_id, match_id, home_score, away_score)
  select id, 't-started', 20, 18 from public.entries where season = '2027';
  raise exception 'FAILED: called a match after kickoff';
exception when raise_exception then raise notice 'ok: a live match locks at its own kickoff';
end $$;
select pg_temp.check((select count(*) from notify.due_reminders()) = 2, 'a called score means no reminder');
update public.members set email_reminders = false where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from notify.due_reminders()) = 1, 'reminders can be turned off');
insert into notify.reminders_sent (user_id, match_id) values ('00000000-0000-0000-0000-00000000000c', 't-soon');
select pg_temp.check((select count(*) from notify.due_reminders()) = 0, 'nobody is reminded twice');

\echo ALL CHECKS PASSED
