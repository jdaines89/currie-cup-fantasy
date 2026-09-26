-- Round prizes: a pool's creator can put up a prize for a round.
--
-- Scrumline never touches the prize. It's the creator's public promise, so
-- the rules make breaking it visible and costly:
--   * every prize names who offered it;
--   * a round's prize can only be added or removed before the round's first
--     kickoff, and never edited;
--   * the winner (most points in the pool that round; ties on exact scores,
--     then right results; still tied, shared) is worked out by the app, and
--     only players who were in the pool at kickoff can win;
--   * only a winner can mark it received;
--   * a prize not marked received within 14 days of the round's last kickoff
--     shows as not delivered, for good, and its creator can't offer another
--     prize until every winner has marked theirs received.
-- Live seasons and your own pools only: school pools and replays are out, and
-- so are pools over 50 people. These are prizes between mates; anything
-- bigger waits for guaranteed prizes, paid up front.

create table public.round_prizes (
  pool_id    bigint  not null references public.pools(id) on delete cascade,
  round      integer not null,
  sponsor    text    not null check (length(btrim(sponsor)) between 1 and 40),
  prize      text    not null check (length(btrim(prize)) between 1 and 60),
  offered_by uuid    not null default auth.uid() references public.members(user_id),
  created_at timestamptz not null default now(),
  primary key (pool_id, round)
);

create table public.prize_receipts (
  pool_id     bigint  not null,
  round       integer not null,
  user_id     uuid    not null default auth.uid() references public.members(user_id),
  received_at timestamptz not null default now(),
  primary key (pool_id, round, user_id),
  foreign key (pool_id, round) references public.round_prizes (pool_id, round) on delete cascade
);

-- How a pool's round went: started, finished, when the prize is due and who won.
create or replace function public.prize_outcome(p_pool bigint, p_round integer)
returns table (started boolean, complete boolean, due_at timestamptz, winners uuid[])
language sql stable security definer
set search_path = public
as $$
  with p as (
    select season from public.pools where id = p_pool
  ), r as (
    select min(m.kickoff_at) as first_ko, max(m.kickoff_at) as last_ko,
           bool_and(m.status in ('FT', 'INTR', 'POSTP')) and bool_or(m.status in ('FT', 'INTR')) as done
    from public.matches m join p on m.season = p.season
    where m.round = p_round
  ), eligible as (
    select pm.user_id, coalesce(t.total_pts, 0) as pts, coalesce(t.exact_scores, 0) as ex, coalesce(t.right_results, 0) as rr
    from public.pool_members pm
    cross join p
    cross join r
    join public.entries e on e.user_id = pm.user_id and e.season = p.season
    left join public.entry_round_totals t on t.entry_id = e.id and t.round = p_round
    where pm.pool_id = p_pool and pm.joined_at <= r.first_ko
  ), best as (
    select pts, ex, rr from eligible order by pts desc, ex desc, rr desc limit 1
  )
  select coalesce(r.first_ko <= now(), false),
         coalesce(r.done, false),
         r.last_ko + interval '14 days',
         case when r.done then (select array_agg(e.user_id order by e.user_id)
                                from eligible e cross join best b
                                where b.pts > 0 and e.pts = b.pts and e.ex = b.ex and e.rr = b.rr) end
  from r
$$;

-- Round has started?
create or replace function public.round_started(p_pool bigint, p_round integer)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select started from public.prize_outcome(p_pool, p_round)), false)
$$;

-- Has this person offered a prize that's now overdue?
create or replace function public.owes_prize(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.round_prizes rp
    cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
    where rp.offered_by = p_user and o.complete and o.due_at < now()
      and exists (select 1 from unnest(o.winners) w
                  where not exists (select 1 from public.prize_receipts pr
                                    where pr.pool_id = rp.pool_id and pr.round = rp.round and pr.user_id = w)))
$$;

-- Can I put up a prize for this round in this pool?
create or replace function public.can_offer_prize(p_pool bigint, p_round integer)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pools p
    join public.seasons s on s.id = p.season
    where p.id = p_pool and p.created_by = auth.uid() and p.school_emis is null and not s.is_replay
      and exists (select 1 from public.matches m where m.season = p.season and m.round = p_round)
      and (select count(*) from public.pool_members pm where pm.pool_id = p.id) <= 50)
    and not public.round_started(p_pool, p_round)
    and not public.owes_prize(auth.uid())
$$;

-- Did I win this round's prize?
create or replace function public.won_prize(p_pool bigint, p_round integer)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.prize_outcome(p_pool, p_round) o where auth.uid() = any (o.winners))
$$;

alter table public.round_prizes enable row level security;
create policy "pool members see prizes" on public.round_prizes for select to authenticated
  using (public.is_pool_member(pool_id));
create policy "creator offers before kickoff" on public.round_prizes for insert to authenticated
  with check (offered_by = auth.uid() and public.can_offer_prize(pool_id, round));
create policy "creator withdraws before kickoff" on public.round_prizes for delete to authenticated
  using (offered_by = auth.uid() and not public.round_started(pool_id, round));

alter table public.prize_receipts enable row level security;
create policy "pool members see receipts" on public.prize_receipts for select to authenticated
  using (public.is_pool_member(pool_id));
create policy "winners mark received" on public.prize_receipts for insert to authenticated
  with check (user_id = auth.uid()
              and public.won_prize(pool_id, round));

revoke all on public.round_prizes, public.prize_receipts from anon, authenticated;
grant select, delete on public.round_prizes to authenticated;
grant insert (pool_id, round, sponsor, prize) on public.round_prizes to authenticated;
grant select on public.prize_receipts to authenticated;
grant insert (pool_id, round) on public.prize_receipts to authenticated;

-- A pool's prizes with their outcome, for the app.
create or replace function public.pool_prizes(p_pool bigint)
returns table (round integer, sponsor text, prize text, offered_by uuid, status text,
               winners uuid[], received uuid[], due_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select rp.round, rp.sponsor, rp.prize, rp.offered_by,
         case when not o.started then 'upcoming'
              when not o.complete then 'in play'
              when o.winners is null then 'no winner'
              when o.winners <@ coalesce(rc.received, '{}') then 'delivered'
              when o.due_at < now() then 'not delivered'
              else 'awaiting' end,
         o.winners, coalesce(rc.received, '{}'), o.due_at
  from public.round_prizes rp
  cross join lateral public.prize_outcome(rp.pool_id, rp.round) o
  left join lateral (select array_agg(pr.user_id) as received from public.prize_receipts pr
                     where pr.pool_id = rp.pool_id and pr.round = rp.round) rc on true
  where rp.pool_id = p_pool and public.is_pool_member(p_pool)
  order by rp.round
$$;

revoke all on function public.prize_outcome(bigint, integer), public.owes_prize(uuid) from public, anon, authenticated;
revoke all on function public.pool_prizes(bigint), public.can_offer_prize(bigint, integer), public.round_started(bigint, integer), public.won_prize(bigint, integer) from public, anon;
grant execute on function public.pool_prizes(bigint), public.can_offer_prize(bigint, integer), public.round_started(bigint, integer), public.won_prize(bigint, integer) to authenticated;
