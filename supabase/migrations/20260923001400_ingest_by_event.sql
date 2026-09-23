-- Results for any tournament, fetched per match.
--
-- TheSportsDB's free key caps a round request at five matches (a URC round
-- has eight) but answers lookupevent.php for every match, and match ids run
-- in sequence through a season. So the feed is read per match:
--
--   every 15 minutes  matches in play or overdue a score (as before)
--   daily 03:00 UTC   matches in the coming week, to catch moved kickoffs,
--                     plus the next ten ids after each live season's last
--                     known match, which is how new fixtures (playoffs) arrive
--
-- raw.request_event_ids() backfills a whole season once, in batches that
-- stay under the free key's rate limit.
--
-- core_load_events() now maps each event to a season by league and season
-- name, skips events for seasons we don't run, and adds any team it hasn't
-- seen, with its badge from the event. Colours for new teams come from
-- supabase/team-brand.ts via the seed.

create or replace function public.core_load_events(p_raw_id bigint)
returns int
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  n int;
begin
  with src as (
    select e, f.id as raw_id
    from raw.feed_payloads f,
         jsonb_array_elements(case when jsonb_typeof(f.payload -> 'events') = 'array'
                                   then f.payload -> 'events' else '[]'::jsonb end) as e
    where f.id = p_raw_id
  ), typed as (
    select
      e ->> 'idEvent'                                            as id,
      s.id                                                       as season,
      (e ->> 'intRound')::int                                    as round,
      coalesce(nullif(e ->> 'strTimestamp', '') || 'Z',
               (e ->> 'dateEvent') || 'T' || coalesce(nullif(e ->> 'strTime', ''), '00:00:00') || 'Z')::timestamptz
                                                                 as kickoff_at,
      e ->> 'idHomeTeam'                                         as home_team_id,
      e ->> 'idAwayTeam'                                         as away_team_id,
      nullif(e ->> 'intHomeScore', '')::int                      as home_score,
      nullif(e ->> 'intAwayScore', '')::int                      as away_score,
      nullif(e ->> 'strVenue', '')                               as venue,
      case
        when e ->> 'strStatus' in ('FT', 'Match Finished', 'AET') then 'FT'
        when e ->> 'strStatus' in ('INTR', 'Interrupted', 'Abandoned') then 'INTR'
        when e ->> 'strStatus' in ('POSTP', 'Postponed') then 'POSTP'
        when nullif(e ->> 'intHomeScore', '') is not null
             and coalesce(e ->> 'strStatus', '') not in ('1H', '2H', 'HT', 'Live', 'In Progress') then 'FT'
        else 'SCHEDULED'
      end                                                        as status,
      raw_id, e
    from src
    join public.seasons s on s.competition_id = src.e ->> 'idLeague' and s.feed_season = src.e ->> 'strSeason'
    where (e ->> 'intRound') ~ '^[0-9]+$' and (e ->> 'intRound')::int > 0
  ), new_teams as (
    insert into public.teams as t (id, name, display_name, short_name, badge_url, source)
    select distinct on (tid) tid, tname, tname, upper(left(regexp_replace(tname, '^The ', ''), 3)), badge, 'thesportsdb'
    from typed,
         lateral (values (home_team_id, coalesce(nullif(e ->> 'strHomeTeam', ''), home_team_id), nullif(e ->> 'strHomeTeamBadge', '')),
                         (away_team_id, coalesce(nullif(e ->> 'strAwayTeam', ''), away_team_id), nullif(e ->> 'strAwayTeamBadge', ''))) v(tid, tname, badge)
    on conflict (id) do update set badge_url = coalesce(t.badge_url, excluded.badge_url)
  )
  insert into public.matches as m
    (id, season, round, kickoff_at, home_team_id, away_team_id,
     home_score, away_score, venue, status, source, raw_id, updated_at)
  select id, season, round, kickoff_at, home_team_id, away_team_id,
         case when status = 'SCHEDULED' then null else home_score end,
         case when status = 'SCHEDULED' then null else away_score end,
         venue, status, 'thesportsdb', raw_id, now()
  from typed
  on conflict (id) do update set
    round      = excluded.round,
    kickoff_at = excluded.kickoff_at,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    venue      = coalesce(excluded.venue, m.venue),
    status     = excluded.status,
    raw_id     = excluded.raw_id,
    updated_at = now()
  where (m.round, m.kickoff_at, m.home_score, m.away_score, m.status)
        is distinct from (excluded.round, excluded.kickoff_at, excluded.home_score, excluded.away_score, excluded.status);

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.core_load_events(bigint) from public, anon, authenticated;

-- Ask the feed about specific matches.
create or replace function raw.request_event_ids(p_ids text[])
returns int
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  i text;
  rid bigint;
begin
  foreach i in array p_ids loop
    rid := net.http_get(
      url := 'https://www.thesportsdb.com/api/v1/json/3/lookupevent.php',
      params := jsonb_build_object('id', i)
    );
    insert into raw.pending_requests (request_id, endpoint, params)
    values (rid, 'lookupevent.php', jsonb_build_object('id', i));
  end loop;
  return coalesce(cardinality(p_ids), 0);
end;
$$;

-- What to ask about. p_daily adds the coming week and the next new ids.
create or replace function raw.request_live(p_daily boolean default false)
returns int
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  ids text[];
begin
  select array_agg(distinct x) into ids from (
    select m.id as x
    from public.matches m join public.seasons s on s.id = m.season and not s.is_replay
    where m.kickoff_at between now() - interval '6 hours' and now()
       or (m.kickoff_at < now() and m.home_score is null and m.status not in ('POSTP'))
       or (p_daily and m.kickoff_at between now() and now() + interval '7 days')
    union
    select (last_id + k)::text
    from (select max(m.id::bigint) as last_id
          from public.matches m join public.seasons s on s.id = m.season and not s.is_replay
          where m.id ~ '^[0-9]+$' group by s.id) l,
         generate_series(1, 10) k
    where p_daily
  ) q
  where not exists (select 1 from raw.pending_requests p where p.params ->> 'id' = q.x);
  if ids is null then return 0; end if;
  return raw.request_event_ids(ids);
end;
$$;

revoke all on function raw.request_event_ids(text[]), raw.request_live(boolean) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('currie-cup-request-live');
    perform cron.unschedule('currie-cup-request-daily');
    perform cron.schedule('feed-request-live', '*/15 * * * *', 'select raw.request_live()');
    perform cron.schedule('feed-request-daily', '0 3 * * *', 'select raw.request_live(true)');
  end if;
end $$;
