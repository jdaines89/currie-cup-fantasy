-- Layer 2: core. Clean, typed, one row per real-world thing.
--
-- Built only from the raw layer by core.load_*() below, never edited by
-- hand. Every row says which source it came from and when it last changed.

create table public.seasons (
  id        text primary key,                        -- '2026'
  name      text not null,
  is_replay boolean not null default false           -- already played; see round_locks
);

create table public.teams (
  id           text primary key,                     -- TheSportsDB idTeam
  name         text not null unique,                 -- as the feed spells it
  display_name text not null,                        -- as the competition spells it
  short_name   text not null,
  stadium      text,
  colour       text,                                 -- jersey colour, #rrggbb
  colour_ink   text,                                 -- text colour that reads on it
  badge_url    text,                                 -- official badge, hotlinked
  source       text not null,
  updated_at   timestamptz not null default now()
);

create table public.matches (
  id           text primary key,                     -- TheSportsDB idEvent
  season       text not null references public.seasons(id),
  round        int  not null check (round > 0),
  kickoff_at   timestamptz not null,
  home_team_id text not null references public.teams(id),
  away_team_id text not null references public.teams(id),
  home_score   int check (home_score >= 0),          -- null until played
  away_score   int check (away_score >= 0),
  venue        text,
  status       text not null check (status in ('SCHEDULED', 'FT', 'INTR', 'POSTP')),
  source       text not null,
  raw_id       bigint references raw.feed_payloads(id),  -- payload this row was last built from
  updated_at   timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  check ((home_score is null) = (away_score is null))
);
create index matches_season_round on public.matches (season, round);

-- The real season bonus-point totals, read off a published table once a
-- season has finished. A sourced fact, never computed: no free feed carries
-- the per-match try counts the try bonus needs.
create table public.season_bonus_points (
  season       text not null references public.seasons(id),
  team_id      text not null references public.teams(id),
  bonus_points int  not null check (bonus_points >= 0),
  source       text not null,
  as_of        date not null,
  primary key (season, team_id)
);

create table public.players (
  id             bigint generated always as identity primary key,
  team_id        text not null references public.teams(id),
  name           text not null,
  position       text not null,
  position_group text not null check (position_group in
                   ('FRONT_ROW', 'LOCK', 'LOOSE', 'HALVES', 'CENTRE', 'BACK_THREE')),
  price          numeric(5,1) not null check (price > 0),
  source         text not null,
  as_of          date not null,
  unique (team_id, name)
);

create table public.player_match_stats (
  player_id     bigint not null references public.players(id) on delete cascade,
  match_id      text   not null references public.matches(id) on delete cascade,
  minutes       int not null default 0 check (minutes between 0 and 120),
  tries         int not null default 0 check (tries >= 0),
  try_assists   int not null default 0 check (try_assists >= 0),
  conversions   int not null default 0 check (conversions >= 0),
  penalties     int not null default 0 check (penalties >= 0),
  drop_goals    int not null default 0 check (drop_goals >= 0),
  tackles       int not null default 0 check (tackles >= 0),
  carries       int not null default 0 check (carries >= 0),
  metres        int not null default 0,
  turnovers_won int not null default 0 check (turnovers_won >= 0),
  yellow_cards  int not null default 0 check (yellow_cards between 0 and 2),
  red_cards     int not null default 0 check (red_cards between 0 and 1),
  source        text not null,
  primary key (player_id, match_id)
);

-- Raw -> core for one round of TheSportsDB events. Idempotent: rerunning it
-- on the same payload changes nothing. Teams must already exist, so an event
-- naming a team we don't know fails loudly instead of inventing one.
create or replace function core_load_events(p_raw_id bigint)
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
         jsonb_array_elements(coalesce(f.payload -> 'events', '[]'::jsonb)) as e
    where f.id = p_raw_id
  ), typed as (
    select
      e ->> 'idEvent'                                            as id,
      e ->> 'strSeason'                                          as season,
      (e ->> 'intRound')::int                                    as round,
      ((e ->> 'dateEvent') || 'T' || coalesce(nullif(e ->> 'strTime', ''), '00:00:00') || 'Z')::timestamptz
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
        when nullif(e ->> 'intHomeScore', '') is not null then 'FT'
        else 'SCHEDULED'
      end                                                        as status,
      raw_id
    from src
  )
  insert into public.matches as m
    (id, season, round, kickoff_at, home_team_id, away_team_id,
     home_score, away_score, venue, status, source, raw_id, updated_at)
  select id, season, round, kickoff_at, home_team_id, away_team_id,
         home_score, away_score, venue, status, 'thesportsdb', raw_id, now()
  from typed
  on conflict (id) do update set
    kickoff_at = excluded.kickoff_at,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    venue      = coalesce(excluded.venue, m.venue),
    status     = excluded.status,
    raw_id     = excluded.raw_id,
    updated_at = now()
  where (m.kickoff_at, m.home_score, m.away_score, m.status)
        is distinct from (excluded.kickoff_at, excluded.home_score, excluded.away_score, excluded.status);

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function core_load_events(bigint) from public, anon, authenticated;
