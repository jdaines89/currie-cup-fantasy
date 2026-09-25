-- Form guide: each side's last five results, shown under every match on Predict.
--
-- A new tournament has no results of its own yet, so form reaches back into
-- the feed's history. public.team_results keeps every finished match the feed
-- has ever sent us, in any league or season, including the ones
-- core_load_events skips because we don't run that season. A trigger on
-- raw.feed_payloads fills it, so it grows with the ingest we already do and
-- costs no extra requests. Last season's URC was backfilled once through
-- raw.request_event_ids (ids 2268008 onwards).
--
-- public.team_form(teams, before) reads that history plus our own matches and
-- returns a string like 'WWDLL', oldest first, so the newest is on the right.

create table public.team_results (
  match_id      text primary key,
  competition_id text,
  feed_season   text,
  kickoff_at    timestamptz not null,
  home_team_id  text not null,
  away_team_id  text not null,
  home_score    int not null,
  away_score    int not null,
  raw_id        bigint,
  loaded_at     timestamptz not null default now()
);
create index team_results_home on public.team_results (home_team_id, kickoff_at desc);
create index team_results_away on public.team_results (away_team_id, kickoff_at desc);

alter table public.team_results enable row level security;
revoke all on public.team_results from anon, authenticated;
grant select on public.team_results to authenticated;
create policy "members read" on public.team_results for select to authenticated using (public.is_member());

create or replace function raw.load_team_results(p_raw_id bigint)
returns void
language sql
security definer
set search_path = public, raw
as $$
  insert into public.team_results as t
    (match_id, competition_id, feed_season, kickoff_at, home_team_id, away_team_id, home_score, away_score, raw_id)
  select e ->> 'idEvent', e ->> 'idLeague', e ->> 'strSeason',
         coalesce(nullif(e ->> 'strTimestamp', '') || 'Z',
                  (e ->> 'dateEvent') || 'T' || coalesce(nullif(e ->> 'strTime', ''), '00:00:00') || 'Z')::timestamptz,
         e ->> 'idHomeTeam', e ->> 'idAwayTeam',
         (e ->> 'intHomeScore')::int, (e ->> 'intAwayScore')::int, f.id
  from raw.feed_payloads f,
       jsonb_array_elements(
         case when jsonb_typeof(f.payload -> 'events') = 'array' then f.payload -> 'events'
              when jsonb_typeof(f.payload -> 'results') = 'array' then f.payload -> 'results'
              else '[]'::jsonb end) e
  where f.id = p_raw_id and f.source = 'thesportsdb'
    and e ->> 'strSport' is distinct from 'Soccer'
    and (e ->> 'intHomeScore') ~ '^[0-9]+$' and (e ->> 'intAwayScore') ~ '^[0-9]+$'
    and coalesce(e ->> 'strStatus', 'FT') in ('FT', 'Match Finished', 'AET', 'AOT', '')
    and nullif(e ->> 'idHomeTeam', '') is not null and nullif(e ->> 'idAwayTeam', '') is not null
  on conflict (match_id) do update set
    home_score = excluded.home_score, away_score = excluded.away_score,
    kickoff_at = excluded.kickoff_at, raw_id = excluded.raw_id, loaded_at = now()
  where (t.home_score, t.away_score, t.kickoff_at) is distinct from (excluded.home_score, excluded.away_score, excluded.kickoff_at);
$$;

create or replace function raw.keep_team_results()
returns trigger
language plpgsql
security definer
set search_path = public, raw
as $$
begin
  perform raw.load_team_results(new.id);
  return new;
end;
$$;
revoke all on function raw.load_team_results(bigint), raw.keep_team_results() from public, anon, authenticated;

create trigger keep_team_results after insert on raw.feed_payloads
  for each row execute function raw.keep_team_results();

-- Everything already landed.
select raw.load_team_results(id) from raw.feed_payloads where source = 'thesportsdb' order by id;

create or replace function public.team_form(p_teams text[], p_before timestamptz default now())
returns table (team_id text, form text)
language sql
stable
security invoker
set search_path = public
as $$
  with results as (
    select match_id as id, kickoff_at, home_team_id, away_team_id, home_score, away_score from public.team_results
    union
    select id, kickoff_at, home_team_id, away_team_id, home_score, away_score from public.matches
    where status in ('FT', 'INTR') and home_score is not null
  ), sides as (
    select distinct on (t, id) t, id, kickoff_at,
           case when mine > theirs then 'W' when mine < theirs then 'L' else 'D' end as r
    from results,
         lateral (values (home_team_id, home_score, away_score), (away_team_id, away_score, home_score)) v(t, mine, theirs)
    where t = any (p_teams) and kickoff_at < p_before
  ), last5 as (
    select t, r, kickoff_at, row_number() over (partition by t order by kickoff_at desc) as n from sides
  )
  select t, string_agg(r, '' order by kickoff_at) from last5 where n <= 5 group by t;
$$;
revoke all on function public.team_form(text[], timestamptz) from public, anon;
grant execute on function public.team_form(text[], timestamptz) to authenticated;
