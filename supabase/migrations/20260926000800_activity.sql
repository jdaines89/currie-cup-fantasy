-- Retention tracking. One row per player per day per kind of activity, with a
-- count. Daily grain keeps the table small (a busy player is a handful of rows
-- a day) while still answering every retention question: who came back, which
-- week, what they did. Actions that change data are logged by triggers, so
-- they can't be faked or missed; app opens and page views come from the app
-- through track(), which only ever logs for the signed-in player.
create table public.activity (
  user_id uuid    not null references public.members(user_id) on delete cascade,
  day     date    not null,
  kind    text    not null check (kind in ('open', 'predict', 'leaderboard', 'chat', 'pools', 'fixtures',
                                          'call', 'lock', 'message', 'reaction', 'join')),
  n       integer not null default 1,
  primary key (user_id, day, kind)
);
create index activity_day on public.activity (day);
alter table public.activity enable row level security;
-- No policies: nobody reads or writes it directly through the API.
revoke all on public.activity from anon, authenticated;

-- South African day, so a Saturday-night call counts on Saturday.
create or replace function public.log_activity(p_user uuid, p_kind text, p_at timestamptz default now())
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.activity (user_id, day, kind)
  select p_user, (p_at at time zone 'Africa/Johannesburg')::date, p_kind
  where exists (select 1 from public.members where user_id = p_user)
  on conflict (user_id, day, kind) do update set n = activity.n + 1
$$;
revoke execute on function public.log_activity(uuid, text, timestamptz) from anon, authenticated, public;

-- Called by the app for opens and page views.
create or replace function public.track(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('open', 'predict', 'leaderboard', 'chat', 'pools', 'fixtures') then
    raise exception 'Unknown activity %', p_kind using errcode = 'check_violation';
  end if;
  perform public.log_activity(auth.uid(), p_kind);
end $$;
revoke execute on function public.track(text) from anon, public;
grant execute on function public.track(text) to authenticated;

-- Server-side actions.
create or replace function public.activity_from_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  case tg_table_name
    when 'predictions' then
      perform public.log_activity((select user_id from public.entries where id = new.entry_id), 'call');
    when 'match_locks' then
      perform public.log_activity((select user_id from public.entries where id = new.entry_id), 'lock');
    when 'chat_messages' then
      perform public.log_activity(new.author_id, 'message');
    when 'chat_reactions' then
      perform public.log_activity(new.user_id, 'reaction');
    when 'pool_members' then
      perform public.log_activity(new.user_id, 'join');
  end case;
  return null;
end $$;
revoke execute on function public.activity_from_row() from anon, authenticated, public;

create trigger activity_call after insert or update of home_score, away_score on public.predictions
  for each row execute function public.activity_from_row();
create trigger activity_lock after insert on public.match_locks
  for each row execute function public.activity_from_row();
create trigger activity_message after insert on public.chat_messages
  for each row execute function public.activity_from_row();
create trigger activity_reaction after insert on public.chat_reactions
  for each row execute function public.activity_from_row();
create trigger activity_join after insert on public.pool_members
  for each row execute function public.activity_from_row();

-- What we can recover from before tracking started. Opens and page views are
-- gone; calls only keep their last edit time.
insert into public.activity (user_id, day, kind, n)
select user_id, day, kind, count(*) from (
  select e.user_id, (p.updated_at at time zone 'Africa/Johannesburg')::date as day, 'call' as kind
    from public.predictions p join public.entries e on e.id = p.entry_id
  union all
  select e.user_id, (l.locked_at at time zone 'Africa/Johannesburg')::date, 'lock'
    from public.match_locks l join public.entries e on e.id = l.entry_id
  union all
  select author_id, (created_at at time zone 'Africa/Johannesburg')::date, 'message' from public.chat_messages
  union all
  select user_id, (created_at at time zone 'Africa/Johannesburg')::date, 'reaction' from public.chat_reactions
  union all
  select user_id, (joined_at at time zone 'Africa/Johannesburg')::date, 'join' from public.pool_members
) x
where exists (select 1 from public.members m where m.user_id = x.user_id)
group by 1, 2, 3
on conflict (user_id, day, kind) do update set n = excluded.n;

-- Only league admins (or SQL run by the owner, which has no signed-in user).
create or replace function public.is_admin_caller()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is null or exists (select 1 from public.members where user_id = auth.uid() and is_admin)
$$;
revoke execute on function public.is_admin_caller() from anon, authenticated, public;

-- Week by week, Monday to Sunday: the numbers an investor asks for first.
--   players     members by the end of the week
--   new_players joined that week
--   active      did anything that week
--   callers     made at least one call that week
--   returners   active that week and also active the week before
--   retained    returners / active the week before
create or replace function public.weekly_metrics(p_weeks integer default 12)
returns table (week date, players bigint, new_players bigint, active bigint, callers bigint,
               returners bigint, retained numeric, calls bigint, messages bigint)
language sql
stable
security definer
set search_path = public
as $$
  with weeks as (
    select generate_series(date_trunc('week', now() at time zone 'Africa/Johannesburg')::date - 7 * (p_weeks - 1),
                           date_trunc('week', now() at time zone 'Africa/Johannesburg')::date, interval '7 days')::date as week
  ), act as (
    select date_trunc('week', day)::date as week, user_id,
           sum(n) filter (where kind = 'call') as calls, sum(n) filter (where kind = 'message') as messages
    from public.activity group by 1, 2
  )
  select w.week,
         (select count(*) from public.members m where (m.joined_at at time zone 'Africa/Johannesburg')::date < w.week + 7),
         (select count(*) from public.members m where (m.joined_at at time zone 'Africa/Johannesburg')::date between w.week and w.week + 6),
         (select count(*) from act a where a.week = w.week),
         (select count(*) from act a where a.week = w.week and a.calls > 0),
         (select count(*) from act a join act b on b.user_id = a.user_id and b.week = w.week - 7 where a.week = w.week),
         round((select count(*) from act a join act b on b.user_id = a.user_id and b.week = w.week - 7 where a.week = w.week)::numeric
               / nullif((select count(*) from act b where b.week = w.week - 7), 0), 2),
         coalesce((select sum(calls) from act a where a.week = w.week), 0)::bigint,
         coalesce((select sum(messages) from act a where a.week = w.week), 0)::bigint
  from weeks w
  where public.is_admin_caller()
  order by w.week desc
$$;
revoke execute on function public.weekly_metrics(integer) from anon, public;
grant execute on function public.weekly_metrics(integer) to authenticated;

-- Per round of each live tournament: of the players with a team, how many
-- called at least one match. The single best "are they coming back" number.
create or replace function public.round_participation(p_season text)
returns table (round integer, first_kickoff timestamptz, teams bigint, callers bigint, share numeric, calls bigint)
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select m.round, min(m.kickoff_at) first_ko from public.matches m where m.season = p_season group by m.round
  )
  select r.round, r.first_ko,
         (select count(*) from public.entries e where e.season = p_season and e.created_at < r.first_ko + interval '7 days'),
         count(distinct p.entry_id),
         round(count(distinct p.entry_id)::numeric
               / nullif((select count(*) from public.entries e where e.season = p_season and e.created_at < r.first_ko + interval '7 days'), 0), 2),
         count(p.*)
  from r
  left join public.matches m on m.season = p_season and m.round = r.round
  left join public.predictions p on p.match_id = m.id
  where public.is_admin_caller()
  group by r.round, r.first_ko
  order by r.round
$$;
revoke execute on function public.round_participation(text) from anon, public;
grant execute on function public.round_participation(text) to authenticated;
