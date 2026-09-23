-- Lock a call early to see who else has.
--
-- In a live season every call locks at its match's kickoff. Now you can also
-- lock one yourself before then. It can't be undone, and your call can't
-- change after it. The payoff: you see the calls of pool mates who have
-- locked the same match too. Neither of you can change anything by then, so
-- nobody can copy. After kickoff everyone's call is locked, so everyone sees
-- everything, as before. Replay seasons are unchanged.

create table public.match_locks (
  entry_id  bigint not null references public.entries(id) on delete cascade,
  match_id  text   not null references public.matches(id) on delete cascade,
  locked_at timestamptz not null default now(),
  primary key (entry_id, match_id)
);

-- Only a call you've made, in a live season, before kickoff.
create or replace function public.check_match_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.predictions p
    join public.matches m on m.id = p.match_id
    join public.seasons s on s.id = m.season
    where p.entry_id = new.entry_id and p.match_id = new.match_id
      and not s.is_replay and m.kickoff_at > now()
  ) then
    raise exception 'Only a called match that has not kicked off can be locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger match_locks_rules before insert on public.match_locks
  for each row execute function public.check_match_lock();

alter table public.match_locks enable row level security;
alter table public.match_locks force row level security;
revoke all on public.match_locks from anon;
revoke update, delete on public.match_locks from authenticated;
grant select, insert on public.match_locks to authenticated;
create policy "members read" on public.match_locks for select to authenticated using (public.is_member());
create policy "lock own call" on public.match_locks for insert to authenticated with check (public.owns_entry(entry_id));

create or replace function public.prediction_locked(p_entry bigint, p_match text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select case when s.is_replay then public.round_locked(p_entry, m.season, m.round)
              else m.kickoff_at <= now()
                   or exists (select 1 from public.match_locks l where l.entry_id = p_entry and l.match_id = p_match) end
  from public.matches m join public.seasons s on s.id = m.season
  where m.id = p_match
$$;

-- Before kickoff in a live season you also need your own call locked.
create or replace function public.can_see_prediction(p_entry bigint, p_match text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.owns_entry(p_entry)
      or (public.prediction_locked(p_entry, p_match)
          and exists (
            select 1
            from public.entries e
            join public.pools p on p.season = e.season
            join public.pool_members theirs on theirs.pool_id = p.id and theirs.user_id = e.user_id
            join public.pool_members mine on mine.pool_id = p.id and mine.user_id = auth.uid()
            where e.id = p_entry)
          and (
            exists (select 1 from public.matches m join public.seasons s on s.id = m.season
                    where m.id = p_match and (s.is_replay or m.kickoff_at <= now()))
            or exists (select 1 from public.entries me join public.match_locks l on l.entry_id = me.id
                       where me.user_id = auth.uid() and l.match_id = p_match)))
$$;
