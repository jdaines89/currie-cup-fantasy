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
select pg_temp.check((select count(*) from public.teams t where badge_url is not null and exists (select 1 from public.matches m where m.season = '2026' and t.id in (m.home_team_id, m.away_team_id))) = 8, 'seed: 8 Currie Cup badges');

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
insert into public.pools (season, name) values ('2026', 'Test pool');
select pg_temp.check((select count(*) from public.pool_members) = 1, 'starting a pool puts you in it');
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

select join_code as code, id as poolid from public.pools where name = 'Test pool' \gset

-- Andy: joins with the code, sees Justin on the pool leaderboard, cannot touch his picks
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.pools) = 0, 'a pool is invisible until you join it');
do $$ begin
  perform public.join_pool('NOPE00');
  raise exception 'FAILED: joined with a wrong code';
exception when raise_exception then raise notice 'ok: a wrong code joins nothing';
end $$;
select public.join_pool(lower(:'code'));
select pg_temp.check((select count(*) from public.pool_leaderboard where team_name = 'Daines XV') = 1, 'Andy sees Justin on the pool leaderboard');
select pg_temp.check((select count(*) from public.predictions) = 2, 'Andy sees Justin''s calls once his round is locked');
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
select pg_temp.check((select total_points from public.pool_leaderboard where team_name = 'Daines XV') = 46,
  'leaderboard totals predictions only');
select pg_temp.check((select (res_pts, mar_pts, cls_pts, exa_pts, banker_pts) = (12::bigint, 5::bigint, 4::bigint, 5::bigint, 20::bigint)
  from public.pool_leaderboard where team_name = 'Daines XV'), 'leaderboard breakdown adds up: 12 + 5 + 4 + 5 + 20 Banker = 46');

-- The ingest transform: a TheSportsDB round payload lands in core, idempotently
insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'eventsround.php', '{"r":1}',
  '{"events":[{"idEvent":"2498543","idLeague":"5069","strSeason":"2026","intRound":"1","dateEvent":"2026-07-17","strTime":"14:00:00",
    "idHomeTeam":"142072","idAwayTeam":"142073","intHomeScore":"24","intAwayScore":"27","strVenue":"Mbombela Stadium","strStatus":"FT"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a changed score updates core');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 0, 'rerunning the same payload changes nothing');
select pg_temp.check((select away_score from public.matches where id = '2498543') = 27, 'core carries the new score');

-- Per-match lookups for any tournament: the event names its league and season
insert into raw.feed_payloads (source, endpoint, params, payload) values ('thesportsdb', 'lookupevent.php', '{"id":"2550100"}',
  '{"events":[{"idEvent":"2550100","idLeague":"4446","strSeason":"2026-2027","intRound":"1","strTimestamp":"2026-09-26T16:30:00",
    "idHomeTeam":"135606","strHomeTeam":"Zebre","idAwayTeam":"999001","strAwayTeam":"The Newcomers","strAwayTeamBadge":"https://example.com/b.png",
    "intHomeScore":null,"intAwayScore":null,"strStatus":"NS"},
   {"idEvent":"1","idLeague":"4328","strSeason":"2026-2027","intRound":"1","strTimestamp":"2026-09-26T14:00:00",
    "idHomeTeam":"133604","strHomeTeam":"Arsenal","idAwayTeam":"133602","strAwayTeam":"Chelsea","strStatus":"NS"}]}');
select pg_temp.check(core_load_events((select max(id) from raw.feed_payloads)) = 1, 'a URC match loads; a league we don''t run is skipped');
select pg_temp.check((select season from public.matches where id = '2550100') = 'urc-2026-27', 'the match lands in URC 2026-27');
select pg_temp.check((select badge_url from public.teams where id = '999001') = 'https://example.com/b.png', 'a team the feed introduces is added, with its badge');
select pg_temp.check(not exists (select 1 from public.teams where id = '133604'), 'no teams from other leagues');

-- Supabase's invite inserts the user, then stamps invited_at in an update
reset role;
insert into auth.users (id, email, invited_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000c', 'christo@example.com', null, '{}');
update auth.users set invited_at = now() where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.check(exists (select 1 from public.members where user_id = '00000000-0000-0000-0000-00000000000c'),
  'an invite stamped after the insert still makes a member');

-- Chat: pool mates talk, tags are read out, nobody posts as someone else
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.chat_messages (pool_id, body) values (:poolid,
  '<@00000000-0000-0000-0000-00000000000b> looks like you''re taking this round. <@00000000-0000-0000-0000-00000000000c> <@00000000-0000-0000-0000-0000000000ff>?');
select pg_temp.check((select count(*) from public.chat_mentions) = 1, 'a tag counts only for someone in the pool');
select pg_temp.check((select user_id::text from public.chat_mentions) = '00000000-0000-0000-0000-00000000000b', 'the tag points at Andy');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.chat_messages) = 1, 'Andy reads the chat');
do $$ begin
  insert into public.chat_messages (pool_id, author_id, body)
  select id, '00000000-0000-0000-0000-00000000000a', 'I am Justin' from public.pools;
  raise exception 'FAILED: posted as someone else';
exception when insufficient_privilege then raise notice 'ok: nobody posts as someone else';
end $$;
delete from public.chat_messages;
do $$ begin
  update public.chat_messages set body = 'edited';
  raise exception 'FAILED: edited a message';
exception when insufficient_privilege then raise notice 'ok: messages cannot be edited';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.chat_messages) = 0, 'a member outside the pool reads none of its chat');
select pg_temp.check((select unread from public.chat_unread) is null, 'and gets no unread count for it');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ff');
select pg_temp.check((select count(*) from public.chat_messages) = 0, 'a stranger reads no chat');
do $$ begin
  insert into public.chat_messages (pool_id, body) values (1, 'let me in');
  raise exception 'FAILED: stranger posted';
exception when insufficient_privilege then raise notice 'ok: a stranger cannot post';
end $$;
reset role;
select pg_temp.check((select count(*) from public.chat_messages) = 1, 'Andy could not delete Justin''s message');

-- Kickoff reminders, on a live season: one match started, one in 30 minutes
insert into public.seasons (id, name, is_replay, competition_id, feed_season) values ('2027', 'Currie Cup 2027', false, '5069', '2027');
insert into public.pools (season, name, created_by) values ('2027', 'Live pool', '00000000-0000-0000-0000-00000000000a');
insert into public.pool_members (pool_id, user_id)
select id, u from public.pools, unnest(array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[]) u
where name = 'Live pool';
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

-- Seeing calls: hidden before kickoff, shown to pool mates after it
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.predictions where match_id = 't-soon') = 0, 'a pool mate''s call is hidden before kickoff');
reset role;
update public.matches set kickoff_at = now() - interval '1 minute' where id = 't-soon';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.predictions where match_id = 't-soon') = 1, 'a pool mate''s call shows after kickoff');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.predictions where match_id = '2498543') = 0, 'calls stay hidden from members outside the pool');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.predictions) = 3, 'you always see your own calls');
reset role;

-- Early locks: see a mate's call before kickoff only once you've both locked
reset role;
update public.matches set kickoff_at = now() + interval '2 hours' where id = 't-later';
insert into public.entries (user_id, season, team_name) values ('00000000-0000-0000-0000-00000000000b', '2027', 'Reeves XV');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-later', 30, 10 from public.entries where season = '2027';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.match_locks (entry_id, match_id) select id, 't-later' from public.entries where season = '2027' and user_id = auth.uid();
do $$ begin
  update public.predictions set home_score = 1 where match_id = 't-later' and entry_id in (select id from public.entries where user_id = auth.uid());
  raise exception 'FAILED: changed a locked call';
exception when raise_exception then raise notice 'ok: a locked call cannot change';
end $$;
select pg_temp.check((select count(*) from public.predictions where match_id = 't-later') = 1, 'locking alone shows nobody else''s call');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.predictions where match_id = 't-later') = 1, 'an unlocked mate cannot see a locked call');
insert into public.match_locks (entry_id, match_id) select id, 't-later' from public.entries where season = '2027' and user_id = auth.uid();
select pg_temp.check((select count(*) from public.predictions where match_id = 't-later') = 2, 'both locked: both calls show');
do $$ begin
  delete from public.match_locks;
  raise exception 'FAILED: undid a lock';
exception when insufficient_privilege then raise notice 'ok: a match lock cannot be undone';
end $$;
reset role;

-- Loopholes closed in the 2026-09-23 security review
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  update public.predictions set match_id = 't-future'
  where match_id = 't-later' and entry_id in (select id from public.entries where user_id = auth.uid());
  raise exception 'FAILED: moved a locked call to an open match';
exception when raise_exception then raise notice 'ok: a locked call cannot be moved to another match';
end $$;
do $$ begin
  insert into public.chat_messages (pool_id, body, created_at)
  select pool_id, 'from the future', now() + interval '1 year' from public.pool_members where user_id = auth.uid() limit 1;
  raise exception 'FAILED: posted a chat message with its own date';
exception when insufficient_privilege then raise notice 'ok: chat times come from the database';
end $$;
do $$ begin
  update public.members set display_name = 'andy' where user_id = auth.uid();
  raise exception 'FAILED: took a mate''s display name';
exception when unique_violation then raise notice 'ok: display names are unique, ignoring case';
end $$;
do $$ begin
  update public.members set display_name = repeat('x', 25) where user_id = auth.uid();
  raise exception 'FAILED: a 25-character display name was accepted';
exception when check_violation then raise notice 'ok: display names stay short';
end $$;
reset role;

-- Scores a rugby side can't post are refused
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, status, source)
values ('t-future', '2027', 2, now() + interval '5 days', '142072', '142073', 'SCHEDULED', 'test');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  insert into public.predictions (entry_id, match_id, home_score, away_score)
  select id, 't-future', 4, 10 from public.entries where user_id = auth.uid() and season = '2027';
  raise exception 'FAILED: a score of 4 was accepted';
exception when check_violation then raise notice 'ok: 1, 2 and 4 are not rugby scores';
end $$;
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-future', 3, 0 from public.entries where user_id = auth.uid() and season = '2027';
reset role;

-- Bonus points from Wikipedia's log: our losing bonus, their try bonus
insert into public.matches (id, season, round, kickoff_at, home_team_id, away_team_id, home_score, away_score, status, source)
values ('t-played', '2027', 1, now() - interval '3 hours', '142072', '142073', 31, 24, 'FT', 'test');
insert into raw.feed_payloads (source, endpoint, params, payload)
select 'wikipedia', 'wikipedia:parse', '{"season": "2027"}', jsonb_build_object('parse', jsonb_build_object('wikitext',
  E'Intro\n{{#invoke:sports table|main|style=Rugby\n|section=URC league standings\n' ||
  E'| team1  = AAA | name_AAA = {{flagdeco|RSA}} [[2027 ' || h.display_name || ' season|' || h.display_name || E' Rugby]]\n' ||
  E'| team2  = BBB | name_BBB = {{flagdeco|RSA}} [[' || a.display_name || E']]\n' ||
  E'| win_AAA = 1 | draw_AAA = 0 | loss_AAA = 0 | tb_AAA = 1 | lb_AAA = 0\n' ||
  E'| win_BBB = 0 | draw_BBB = 0 | loss_BBB = 1 | tb_BBB = 1 | lb_BBB = 1\n}}\n{{#invoke:sports table|main|section=other\n| win_AAA = 9\n}}'))
from public.teams h, public.teams a where h.id = '142072' and a.id = '142073';
select pg_temp.check(public.core_load_wiki_log((select max(id) from raw.feed_payloads)) = 2, 'Wikipedia''s log lands for both teams');
select pg_temp.check((select log_points from public.standings where season = '2027' and team_id = '142072') = 5, 'win with a try bonus = 5');
select pg_temp.check((select log_points from public.standings where season = '2027' and team_id = '142073') = 2, 'loss by 7 with a try bonus = 2');
select pg_temp.check((select bool_and(points_exact) from public.standings where season = '2027' and team_id in ('142072', '142073')), 'exact once Wikipedia has caught up');
select pg_temp.check((select count(*) from public.standings where season = '2027') = 6, 'every team in the fixtures is on the log');

-- The crowd: totals across every player, only once your own call is locked
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select calls from public.match_crowd('2027') where match_id = 't-soon') = 1, 'crowd shows a kicked-off match to any member');
select pg_temp.check((select home_wins from public.match_crowd('2027') where match_id = 't-soon') is null, 'crowd hides the split below 3 calls');
select pg_temp.check(not exists (select 1 from public.match_crowd('2027') where match_id = 't-later'), 'crowd is hidden before kickoff until you lock');
insert into public.entries (season, team_name) values ('2027', 'Christo XV');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-later', 12, 15 from public.entries where user_id = auth.uid() and season = '2027';
insert into public.match_locks (entry_id, match_id) select id, 't-later' from public.entries where season = '2027' and user_id = auth.uid();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select (calls, home_wins, draws, away_wins, top_home, top_away, top_calls) = (3, 2, 0, 1, 30, 10, 2)
                      from public.match_crowd('2027') where match_id = 't-later'), 'crowd splits and finds the most common call');
insert into public.predictions (entry_id, match_id, home_score, away_score)
select id, 't-future', 10, 3 from public.entries where user_id = auth.uid() and season = '2027';
insert into public.match_locks (entry_id, match_id) select id, 't-future' from public.entries where season = '2027' and user_id = auth.uid();
select pg_temp.check((select calls from public.match_crowd('2027') where match_id = 't-future') = 1, 'crowd never counts an open call');
select pg_temp.as_user(null);
do $$ begin
  perform public.match_crowd('2027');
  raise exception 'FAILED: anon read the crowd';
exception when insufficient_privilege then raise notice 'ok: anon cannot read the crowd';
end $$;
-- Profile pictures: your own folder only, and only members see them
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000a/me.jpg');
update public.members set avatar_path = '00000000-0000-0000-0000-00000000000a/me.jpg' where user_id = auth.uid();
select pg_temp.check((select avatar_path from public.members where user_id = auth.uid()) is not null, 'a member sets their own picture');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000000c/fake.jpg');
  raise exception 'FAILED: uploaded into someone else''s folder';
exception when insufficient_privilege then raise notice 'ok: nobody uploads into another member''s folder';
end $$;
do $$ begin
  update public.members set avatar_path = '00000000-0000-0000-0000-00000000000c/x.jpg' where user_id = auth.uid();
  raise exception 'FAILED: pointed a picture at another member''s folder';
exception when check_violation then raise notice 'ok: a picture can only point at your own folder';
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'avatars') = 1, 'members see each other''s pictures');
delete from storage.objects where bucket_id = 'avatars';
select pg_temp.check((select count(*) from storage.objects where bucket_id = 'avatars') = 1, 'nobody deletes another member''s picture');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from storage.objects) = 0, 'signed-out visitors see no pictures');
reset role;

\echo ALL CHECKS PASSED
