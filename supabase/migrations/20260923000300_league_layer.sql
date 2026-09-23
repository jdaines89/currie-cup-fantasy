-- Layer 3: league. What the members do: their entries and picks.
--
-- Access is invite-only. Supabase Auth creates an auth.users row when an
-- invite is sent; the trigger below turns every invited user into a member.
-- Only invites count (invited_at is set): if public sign-up were ever
-- switched back on by mistake, a self-registered account gets no member row,
-- so row-level security still shows it nothing.

create table public.members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null,
  is_admin     boolean not null default false,
  joined_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.invited_at is null then
    return new;
  end if;
  insert into public.members (user_id, email, display_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.entries (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.members(user_id) on delete cascade default auth.uid(),
  season    text not null references public.seasons(id),
  team_name text not null check (length(team_name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (user_id, season)
);

-- Union Pool: four unions a round, one of them captain.
create table public.pool_picks (
  entry_id   bigint not null references public.entries(id) on delete cascade,
  season     text   not null,
  round      int    not null,
  team_id    text   not null references public.teams(id),
  is_captain boolean not null default false,
  primary key (entry_id, round, team_id)
);
create unique index pool_one_captain on public.pool_picks (entry_id, round) where is_captain;

-- Score predictions: a scoreline per match.
create table public.predictions (
  entry_id   bigint not null references public.entries(id) on delete cascade,
  match_id   text   not null references public.matches(id),
  home_score int    not null check (home_score between 0 and 150),
  away_score int    not null check (away_score between 0 and 150),
  updated_at timestamptz not null default now(),
  primary key (entry_id, match_id)
);

-- Player fantasy: a squad per round.
create table public.squad_picks (
  entry_id   bigint not null references public.entries(id) on delete cascade,
  season     text   not null,
  round      int    not null,
  player_id  bigint not null references public.players(id) on delete cascade,
  is_captain boolean not null default false,
  is_bench   boolean not null default false,
  primary key (entry_id, round, player_id)
);
create unique index squad_one_captain on public.squad_picks (entry_id, round) where is_captain;

-- Rules the database enforces itself, so no client can bend them.

-- A season is either live (rounds lock at their first kickoff) or a replay of
-- one already played (2026 as of now), where each member locks a round in
-- themselves and only then sees how it scored.
-- (public.seasons.is_replay, in the core layer, says which.)

-- A member locking in a round of a replay. No update or delete, ever.
create table public.round_locks (
  entry_id  bigint not null references public.entries(id) on delete cascade,
  season    text   not null references public.seasons(id),
  round     int    not null,
  locked_at timestamptz not null default now(),
  primary key (entry_id, round)
);

create or replace function public.round_locked(p_entry bigint, p_season text, p_round int)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select case
    when (select is_replay from public.seasons where id = p_season)
      then exists (select 1 from public.round_locks where entry_id = p_entry and round = p_round)
    else coalesce((select min(kickoff_at) <= now() from public.matches
                   where season = p_season and round = p_round), true)
  end
$$;

create or replace function public.check_pool_pick()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record := coalesce(new, old);
begin
  if public.round_locked(r.entry_id, r.season, r.round) then
    raise exception 'Round % is locked', r.round using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then
    if not exists (select 1 from public.matches m
                   where m.season = new.season and m.round = new.round
                     and new.team_id in (m.home_team_id, m.away_team_id)) then
      raise exception '% does not play in round %', new.team_id, new.round using errcode = 'P0001';
    end if;
    if (select count(*) from public.pool_picks p
        where p.entry_id = new.entry_id and p.round = new.round and p.team_id <> new.team_id) >= 4 then
      raise exception 'Only four unions a round' using errcode = 'P0001';
    end if;
  end if;
  return r;
end;
$$;
create trigger pool_picks_rules before insert or update or delete on public.pool_picks
  for each row execute function public.check_pool_pick();

create or replace function public.check_prediction()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  m public.matches;
begin
  select * into m from public.matches where id = r.match_id;
  if public.round_locked(r.entry_id, m.season, m.round) then
    raise exception 'Round % is locked', m.round using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then new.updated_at := now(); return new; end if;
  return old;
end;
$$;
create trigger predictions_rules before insert or update or delete on public.predictions
  for each row execute function public.check_prediction();

create or replace function public.check_squad_pick()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record := coalesce(new, old);
begin
  if public.round_locked(r.entry_id, r.season, r.round) then
    raise exception 'Round % is locked', r.round using errcode = 'P0001';
  end if;
  return r;
end;
$$;
create trigger squad_picks_rules before insert or update or delete on public.squad_picks
  for each row execute function public.check_squad_pick();
