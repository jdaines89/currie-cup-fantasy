-- Several tournaments, several pools per tournament, a chat per pool.
--
--   competitions   a tournament (Currie Cup, URC), keyed by TheSportsDB league id
--   seasons        one edition of it (Currie Cup 2026, URC 2026-27), and how
--                  the feed names it (feed_league_id + feed_season)
--   pools          a group of members playing one season together, joined
--                  with a six-letter code
--   pool_members   who is in which pool
--
-- Predictions stay per member per season (entries): you call a match once and
-- that call counts in every pool you're in for that season, so pools are a
-- leaderboard and a chat, never a second set of picks. Access to the app is
-- still invite-only (members); a pool only groups people who are already in.

create table public.competitions (
  id         text primary key,                 -- TheSportsDB idLeague
  name       text not null,
  short_name text not null
);
insert into public.competitions (id, name, short_name) values
  ('5069', 'Currie Cup Premier Division', 'Currie Cup');

alter table public.seasons
  add column competition_id text references public.competitions(id),
  add column feed_season    text,               -- strSeason in the feed: '2026', '2026-2027'
  add column starts_on      date;
update public.seasons set competition_id = '5069', feed_season = '2026', starts_on = '2026-07-17' where id = '2026';
alter table public.seasons alter column competition_id set not null, alter column feed_season set not null;
create unique index seasons_feed on public.seasons (competition_id, feed_season);

create table public.pools (
  id         bigint generated always as identity primary key,
  season     text not null references public.seasons(id),
  name       text not null check (length(btrim(name)) between 1 and 40),
  join_code  text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  created_by uuid not null default auth.uid() references public.members(user_id),
  created_at timestamptz not null default now()
);

create table public.pool_members (
  pool_id   bigint not null references public.pools(id) on delete cascade,
  user_id   uuid   not null references public.members(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);
create index pool_members_user on public.pool_members (user_id);

create or replace function public.is_pool_member(p_pool bigint)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.pool_members where pool_id = p_pool and user_id = auth.uid())
$$;

-- Whoever creates a pool is in it.
create or replace function public.pool_add_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pool_members (pool_id, user_id) values (new.id, new.created_by) on conflict do nothing;
  return new;
end;
$$;
create trigger pools_add_creator after insert on public.pools
  for each row execute function public.pool_add_creator();

-- Joining by code: the one way into someone else's pool.
create or replace function public.join_pool(p_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  pid bigint;
begin
  if not public.is_member() then
    raise exception 'Only league members can join pools' using errcode = '42501';
  end if;
  select id into pid from public.pools where join_code = upper(btrim(p_code));
  if pid is null then
    raise exception 'No pool has that code' using errcode = 'P0001';
  end if;
  insert into public.pool_members (pool_id, user_id) values (pid, auth.uid()) on conflict do nothing;
  return pid;
end;
$$;

alter table public.competitions enable row level security;
alter table public.competitions force row level security;
alter table public.pools enable row level security;
alter table public.pools force row level security;
alter table public.pool_members enable row level security;
alter table public.pool_members force row level security;
revoke all on public.competitions, public.pools, public.pool_members from anon;

create policy "members read" on public.competitions for select to authenticated using (public.is_member());
revoke insert, update, delete on public.competitions from authenticated;

create policy "see your pools" on public.pools for select to authenticated using (public.is_pool_member(id));
create policy "start a pool" on public.pools for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());
create policy "rename your pool" on public.pools for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
revoke update on public.pools from authenticated;
grant update (name) on public.pools to authenticated;

create policy "see your pool mates" on public.pool_members for select to authenticated using (public.is_pool_member(pool_id));
create policy "leave a pool" on public.pool_members for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.pool_members from authenticated;

revoke execute on function public.is_pool_member(bigint), public.join_pool(text) from anon, public;
grant execute on function public.is_pool_member(bigint), public.join_pool(text) to authenticated;
revoke execute on function public.pool_add_creator() from anon, authenticated, public;

-- Everyone already here keeps playing together: one pool for Currie Cup 2026
-- with every current member, created by the first admin (or first member).
insert into public.pools (season, name, created_by)
select '2026', 'The Originals', (select user_id from public.members order by is_admin desc, joined_at limit 1)
where exists (select 1 from public.members);
insert into public.pool_members (pool_id, user_id)
select p.id, m.user_id from public.pools p cross join public.members m
on conflict do nothing;

-- Chat moves into pools.
alter table public.chat_messages add column pool_id bigint references public.pools(id) on delete cascade;
update public.chat_messages set pool_id = (select min(id) from public.pools);
delete from public.chat_messages where pool_id is null;   -- only possible with no pool, so no members
alter table public.chat_messages alter column pool_id set not null;
drop index public.chat_messages_recent;
create index chat_messages_pool on public.chat_messages (pool_id, id desc);

drop policy "members read" on public.chat_messages;
drop policy "post as yourself" on public.chat_messages;
create policy "pool reads" on public.chat_messages for select to authenticated using (public.is_pool_member(pool_id));
create policy "post in your pools" on public.chat_messages for insert to authenticated
  with check (author_id = auth.uid() and public.is_pool_member(pool_id));

-- A tag only counts for someone in that pool.
create or replace function public.chat_extract_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_mentions (message_id, user_id)
  select distinct new.id, pm.user_id
  from regexp_matches(new.body, '<@([0-9a-f-]{36})>', 'g') as t(x)
  join public.pool_members pm on pm.pool_id = new.pool_id and pm.user_id::text = t.x[1]
  on conflict do nothing;
  return new;
end;
$$;

drop policy "members read" on public.chat_mentions;
create policy "pool reads" on public.chat_mentions for select to authenticated
  using (exists (select 1 from public.chat_messages c where c.id = message_id));

-- Read markers per pool.
alter table public.chat_reads add column pool_id bigint references public.pools(id) on delete cascade;
update public.chat_reads set pool_id = (select min(id) from public.pools);
delete from public.chat_reads where pool_id is null;
alter table public.chat_reads drop constraint chat_reads_pkey;
alter table public.chat_reads alter column pool_id set not null;
alter table public.chat_reads add primary key (user_id, pool_id);

-- Unread per pool for the signed-in member, for the Chat badge.
create view public.chat_unread with (security_invoker = true) as
select p.id as pool_id,
       count(c.id) filter (where c.author_id <> auth.uid())                        as unread,
       count(t.message_id)                                                         as tagged
from public.pools p
left join public.chat_reads r on r.pool_id = p.id and r.user_id = auth.uid()
left join public.chat_messages c on c.pool_id = p.id and c.id > coalesce(r.last_read_id, 0)
left join public.chat_mentions t on t.message_id = c.id and t.user_id = auth.uid()
group by p.id;

-- The leaderboard is per pool now. Members of the pool without an entry for
-- its season still show, on zero.
drop view public.leaderboard;
create view public.pool_leaderboard with (security_invoker = true) as
select pm.pool_id, pm.user_id, mb.display_name as manager, e.id as entry_id, e.team_name,
       coalesce(sum(s.total_pts), 0)                        as total_points,
       count(s.match_id) filter (where s.right_result)      as right_results,
       count(s.match_id) filter (where s.exact_pts > 0)     as exact_scores,
       count(distinct s.round)                              as rounds_scored
from public.pool_members pm
join public.pools p on p.id = pm.pool_id
join public.members mb on mb.user_id = pm.user_id
left join public.entries e on e.user_id = pm.user_id and e.season = p.season
left join public.prediction_scores s on s.entry_id = e.id
group by pm.pool_id, pm.user_id, mb.display_name, e.id, e.team_name;

revoke all on public.chat_unread, public.pool_leaderboard from anon;
grant select on public.chat_unread, public.pool_leaderboard to authenticated;

-- Reminders go only to people in a pool for that season.
create or replace function notify.due_reminders(p_now timestamptz default now())
returns table (user_id uuid, email text, display_name text, match_ids text[], lines text[])
language sql stable
set search_path = public, notify
as $$
  select mb.user_id, mb.email, mb.display_name,
         array_agg(m.id order by m.kickoff_at),
         array_agg(to_char(m.kickoff_at at time zone 'Africa/Johannesburg', 'HH24:MI') || '  '
                   || h.display_name || ' v ' || a.display_name order by m.kickoff_at)
  from public.matches m
  join public.seasons s on s.id = m.season and not s.is_replay
  join public.teams h on h.id = m.home_team_id
  join public.teams a on a.id = m.away_team_id
  join public.members mb on mb.email_reminders
    and exists (select 1 from public.pool_members pm join public.pools p on p.id = pm.pool_id
                where pm.user_id = mb.user_id and p.season = m.season)
  where m.kickoff_at > p_now and m.kickoff_at <= p_now + interval '60 minutes'
    and m.status = 'SCHEDULED'
    and not exists (select 1 from public.predictions pr join public.entries e on e.id = pr.entry_id
                    where e.user_id = mb.user_id and e.season = m.season and pr.match_id = m.id)
    and not exists (select 1 from notify.reminders_sent r where r.user_id = mb.user_id and r.match_id = m.id)
  group by mb.user_id, mb.email, mb.display_name
$$;
revoke all on function notify.due_reminders(timestamptz) from public, anon, authenticated;
