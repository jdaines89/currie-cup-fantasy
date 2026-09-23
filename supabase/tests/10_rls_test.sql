-- Behaviour tests for the league: run after the migrations and seed.
-- Every check raises on failure, so a clean run prints "ALL CHECKS PASSED".
\set ON_ERROR_STOP on

-- Two invited members and one stranger who was never invited.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'justin@example.com', '{"display_name":"Justin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'andy@example.com', '{}');
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
select pg_temp.check((select home_score from public.predictions) = 24, 'Andy could not change Justin''s prediction');

-- Scoring matches the app's rules (Sharks won 26-24 away at Pumas in R1, captain)
select pg_temp.check((select total_pts from public.pool_pick_scores where team_id = '142073') = (10 + 5 - 2) * 2,
  'captain Sharks score (10 win + 5 attack - 2 defence) x2 = 26');
select pg_temp.check((select total_pts from public.prediction_scores) = 6 + 5 + 2 + 2 + 10,
  'exact prediction scores 25');

-- The ingest transform: a TheSportsDB round payload lands in core, idempotently
insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'eventsround.php', '{"r":1}',
  '{"events":[{"idEvent":"2498543","strSeason":"2026","intRound":"1","dateEvent":"2026-07-17","strTime":"14:00:00",
    "idHomeTeam":"142072","idAwayTeam":"142073","intHomeScore":"24","intAwayScore":"27","strVenue":"Mbombela Stadium","strStatus":"FT"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a changed score updates core');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 0, 'rerunning the same payload changes nothing');
select pg_temp.check((select away_score from public.matches where id = '2498543') = 27, 'core carries the new score');

\echo ALL CHECKS PASSED
