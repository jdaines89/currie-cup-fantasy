-- Scores are stored, not recalculated on every read.
--
-- Before this, prediction_scores was a view: every leaderboard, race graph
-- and school table re-scored every call from scratch each time someone opened
-- it. Fine for 30 players, slow for 60,000.
--
-- Now a call is scored once, when something that changes its points happens:
--   * a match result or status lands (or is corrected)      -> that match
--   * a call is made, changed or removed on a finished match -> that call
--   * a replay round is locked or unlocked                   -> that round
-- and the points are kept in prediction_points. Running totals per player per
-- round are kept in entry_round_totals, adjusted by the difference each time
-- (never re-summed), so a result costs one pass over that match's calls.
--
-- prediction_scores keeps its name and columns (it now reads the stored
-- points), so the app doesn't change. rescore_all() rebuilds everything from
-- scratch if the stored numbers are ever in doubt.

-- One row per scored call.
create table public.prediction_points (
  entry_id     bigint  not null references public.entries(id) on delete cascade,
  match_id     text    not null references public.matches(id) on delete cascade,
  season       text    not null,
  round        integer not null,
  pred_home    integer not null,
  pred_away    integer not null,
  real_home    integer not null,
  real_away    integer not null,
  right_result boolean not null,
  result_pts   integer not null,
  margin_pts   integer not null,
  near_pts     integer not null,
  exact_pts    integer not null,
  total_pts    integer not null,
  is_banker    boolean not null,
  primary key (entry_id, match_id)
);
create index prediction_points_match on public.prediction_points (match_id);

-- Running totals per player per round.
create table public.entry_round_totals (
  entry_id      bigint  not null references public.entries(id) on delete cascade,
  season        text    not null,
  round         integer not null,
  total_pts     integer not null default 0,
  result_pts    integer not null default 0,
  margin_pts    integer not null default 0,
  near_pts      integer not null default 0,
  exact_pts     integer not null default 0,
  right_results integer not null default 0,
  exact_scores  integer not null default 0,
  matches       integer not null default 0,
  primary key (entry_id, round)
);
create index entry_round_totals_season on public.entry_round_totals (season);

-- Is this entry in one of my pools for its season?
create or replace function public.shares_pool(p_entry bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entries e
    join public.pools p on p.season = e.season
    join public.pool_members theirs on theirs.pool_id = p.id and theirs.user_id = e.user_id
    join public.pool_members mine on mine.pool_id = p.id and mine.user_id = auth.uid()
    where e.id = p_entry)
$$;

-- Same visibility as the calls themselves: your own, and pool mates'.
alter table public.prediction_points enable row level security;
create policy "scores of calls you can see" on public.prediction_points for select to authenticated
  using (public.is_member() and public.can_see_prediction(entry_id, match_id));
alter table public.entry_round_totals enable row level security;
create policy "your totals and pool mates'" on public.entry_round_totals for select to authenticated
  using (public.is_member() and (public.owns_entry(entry_id) or public.shares_pool(entry_id)));
revoke all on public.prediction_points, public.entry_round_totals from anon, authenticated;
grant select on public.prediction_points, public.entry_round_totals to authenticated;

-- The scoring rules, in one place: RES +6, MAR +5 (right result and exact
-- margin), CLS +2 per team within 3, EXA +5, Banker doubles the lot. Only
-- finished matches, and only rounds that are locked for that player.
create or replace function public.compute_points(p_match text default null, p_entry bigint default null)
returns setof public.prediction_points
language sql stable security definer
set search_path = public
as $$
  with played as (
    select pr.entry_id, m.season, m.round, pr.match_id, pr.is_banker,
           pr.home_score as pred_home, pr.away_score as pred_away,
           m.home_score as real_home, m.away_score as real_away,
           sign(pr.home_score - pr.away_score) = sign(m.home_score - m.away_score) as right_result
    from public.predictions pr
    join public.matches m on m.id = pr.match_id
    where (p_match is null or pr.match_id = p_match)
      and (p_entry is null or pr.entry_id = p_entry)
      and m.status in ('FT', 'INTR') and m.home_score is not null and m.away_score is not null
      and public.round_locked(pr.entry_id, m.season, m.round)
  ), parts as (
    select *,
           case when right_result then 6 else 0 end as result_pts,
           case when right_result and pred_home - pred_away = real_home - real_away then 5 else 0 end as margin_pts,
           case when abs(pred_home - real_home) <= 3 then 2 else 0 end
             + case when abs(pred_away - real_away) <= 3 then 2 else 0 end as near_pts,
           case when pred_home = real_home and pred_away = real_away then 5 else 0 end as exact_pts
    from played
  )
  select entry_id, match_id, season, round, pred_home, pred_away, real_home, real_away, right_result,
         result_pts, margin_pts, near_pts, exact_pts,
         (result_pts + margin_pts + near_pts + exact_pts) * case when is_banker then 2 else 1 end,
         is_banker
  from parts
$$;

-- Re-score one match, or one player's call on it.
create or replace function public.score_calls(p_match text, p_entry bigint default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.prediction_points
  where match_id = p_match and (p_entry is null or entry_id = p_entry);
  insert into public.prediction_points select * from public.compute_points(p_match, p_entry);
end
$$;

-- Rebuild everything from scratch.
create or replace function public.rescore_all()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.prediction_points;
  delete from public.entry_round_totals;
  insert into public.prediction_points select * from public.compute_points();
end
$$;

revoke all on function public.compute_points(text, bigint), public.score_calls(text, bigint), public.rescore_all()
  from public, anon, authenticated;

-- Keep the per-round totals in step, by the difference.
create or replace function public.totals_add()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.entry_round_totals as t
    (entry_id, season, round, total_pts, result_pts, margin_pts, near_pts, exact_pts, right_results, exact_scores, matches)
  select entry_id, min(season), round, sum(total_pts), sum(result_pts), sum(margin_pts), sum(near_pts), sum(exact_pts),
         count(*) filter (where right_result), count(*) filter (where exact_pts > 0), count(*)
  from added group by entry_id, round
  on conflict (entry_id, round) do update set
    total_pts = t.total_pts + excluded.total_pts, result_pts = t.result_pts + excluded.result_pts,
    margin_pts = t.margin_pts + excluded.margin_pts, near_pts = t.near_pts + excluded.near_pts,
    exact_pts = t.exact_pts + excluded.exact_pts, right_results = t.right_results + excluded.right_results,
    exact_scores = t.exact_scores + excluded.exact_scores, matches = t.matches + excluded.matches;
  return null;
end
$$;

create or replace function public.totals_remove()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.entry_round_totals t set
    total_pts = t.total_pts - d.total_pts, result_pts = t.result_pts - d.result_pts,
    margin_pts = t.margin_pts - d.margin_pts, near_pts = t.near_pts - d.near_pts,
    exact_pts = t.exact_pts - d.exact_pts, right_results = t.right_results - d.right_results,
    exact_scores = t.exact_scores - d.exact_scores, matches = t.matches - d.matches
  from (select entry_id, round, sum(total_pts) total_pts, sum(result_pts) result_pts, sum(margin_pts) margin_pts,
               sum(near_pts) near_pts, sum(exact_pts) exact_pts, count(*) filter (where right_result) right_results,
               count(*) filter (where exact_pts > 0) exact_scores, count(*) matches
        from removed group by entry_id, round) d
  where t.entry_id = d.entry_id and t.round = d.round;
  delete from public.entry_round_totals t
  using (select distinct entry_id, round from removed) r
  where t.entry_id = r.entry_id and t.round = r.round and t.matches = 0;
  return null;
end
$$;

create trigger prediction_points_added after insert on public.prediction_points
  referencing new table as added for each statement execute function public.totals_add();
create trigger prediction_points_removed after delete on public.prediction_points
  referencing old table as removed for each statement execute function public.totals_remove();

-- What sets scoring off.
create or replace function public.rescore_match()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.score_calls(new.id);
  return null;
end
$$;

create trigger matches_rescore
  after update of home_score, away_score, status, round, season on public.matches
  for each row
  when (old.home_score is distinct from new.home_score or old.away_score is distinct from new.away_score
        or old.status is distinct from new.status or old.round is distinct from new.round
        or old.season is distinct from new.season)
  execute function public.rescore_match();

create or replace function public.rescore_call()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.score_calls(old.match_id, old.entry_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.match_id <> old.match_id or new.entry_id <> old.entry_id) then
    perform public.score_calls(new.match_id, new.entry_id);
  end if;
  return null;
end
$$;

create trigger predictions_rescore
  after insert or update or delete on public.predictions
  for each row execute function public.rescore_call();

create or replace function public.rescore_round()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  m record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  for m in select id from public.matches where season = r.season and round = r.round loop
    perform public.score_calls(m.id, r.entry_id);
  end loop;
  return null;
end
$$;

create trigger round_locks_rescore
  after insert or delete on public.round_locks
  for each row execute function public.rescore_round();

-- Fill it from what's there now.
select public.rescore_all();

-- The old view's name and columns, now reading stored points.
create or replace view public.prediction_scores with (security_invoker = true) as
  select entry_id, season, round, match_id, pred_home, pred_away, real_home, real_away, right_result,
         result_pts, margin_pts, near_pts, exact_pts, total_pts, is_banker
  from public.prediction_points;

-- Leaderboards add up at most one row per player per round.
create or replace view public.pool_leaderboard with (security_invoker = true) as
  select pm.pool_id, pm.user_id, mb.display_name as manager, e.id as entry_id, e.team_name,
         coalesce(sum(t.total_pts), 0)::bigint as total_points,
         coalesce(sum(t.right_results), 0)::bigint as right_results,
         coalesce(sum(t.exact_scores), 0)::bigint as exact_scores,
         count(t.round) filter (where t.matches > 0) as rounds_scored,
         coalesce(sum(t.result_pts), 0)::bigint as res_pts,
         coalesce(sum(t.margin_pts), 0)::bigint as mar_pts,
         coalesce(sum(t.near_pts), 0)::bigint as cls_pts,
         coalesce(sum(t.exact_pts), 0)::bigint as exa_pts,
         coalesce(sum(t.total_pts - t.result_pts - t.margin_pts - t.near_pts - t.exact_pts), 0)::bigint as banker_pts,
         coalesce(sum(t.matches), 0)::bigint as matches_scored
  from public.pool_members pm
  join public.pools p on p.id = pm.pool_id
  join public.members mb on mb.user_id = pm.user_id
  left join public.entries e on e.user_id = pm.user_id and e.season = p.season
  left join public.entry_round_totals t on t.entry_id = e.id
  group by pm.pool_id, pm.user_id, mb.display_name, e.id, e.team_name;

-- The school table reads the stored totals too.
create or replace function public.school_table(p_season text, p_stage text)
returns table (
  emis      text,
  name      text,
  town      text,
  members   int,
  confirmed int,
  seats     int,
  points    int,
  average   numeric,
  mine      boolean
)
language sql stable
security definer
set search_path = public
as $$
  with players as (
    select sm.emis, sm.user_id, sm.verified, e.id as entry_id
    from public.school_members sm
    left join public.entries e on e.user_id = sm.user_id and e.season = p_season
    where sm.stage = p_stage and public.is_member()
  ), pts as (
    select t.entry_id, sum(t.total_pts)::int as pts
    from public.entry_round_totals t
    where t.season = p_season
    group by t.entry_id
  ), ranked as (
    select p.*, coalesce(t.pts, 0) as pts,
           row_number() over (partition by p.emis
                              order by (p.verified and p.entry_id is not null) desc, coalesce(t.pts, 0) desc) as rn
    from players p
    left join pts t on t.entry_id = p.entry_id
  ), per_school as (
    select r.emis, public.school_seats(sc.learners) as seats,
           count(*)::int as members,
           (count(*) filter (where r.verified and r.entry_id is not null))::int as confirmed,
           coalesce(sum(r.pts) filter (where r.verified and r.entry_id is not null
                                        and r.rn <= public.school_seats(sc.learners)), 0)::int as points,
           bool_or(r.user_id = auth.uid()) as mine
    from ranked r
    join public.schools sc on sc.emis = r.emis
    group by r.emis, sc.learners
  )
  select ps.emis, sc.name, sc.town, ps.members, ps.confirmed, ps.seats,
         case when ps.confirmed >= 3 then ps.points end,
         case when ps.confirmed >= 3 then round(ps.points::numeric / ps.seats, 1) end,
         ps.mine
  from per_school ps
  join public.schools sc on sc.emis = ps.emis
$$;
