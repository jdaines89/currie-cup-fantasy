-- The school table: schools ranked against each other in a tournament.
--
-- A school's score is the average points of its confirmed players (at least
-- two schoolmates vouched for them) who have a team in the tournament, so a
-- small school can beat a big one. Unconfirmed players don't count.
--
-- It reads every entry in the season, not just your pools, so it only ever
-- returns school totals, never a player's own score. A school is ranked once
-- it has 3 confirmed players; below that its points are withheld, so the table
-- can't be used to read off one person's total.

create or replace function public.school_table(p_season text, p_stage text)
returns table (
  emis      text,
  name      text,
  town      text,
  members   int,
  confirmed int,
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
    select s.entry_id, sum(s.total_pts)::int as pts
    from public.prediction_scores s
    where s.season = p_season
    group by s.entry_id
  ), per_school as (
    select p.emis,
           count(*)::int as members,
           (count(*) filter (where p.verified and p.entry_id is not null))::int as confirmed,
           coalesce(sum(coalesce(t.pts, 0)) filter (where p.verified and p.entry_id is not null), 0)::int as points,
           bool_or(p.user_id = auth.uid()) as mine
    from players p
    left join pts t on t.entry_id = p.entry_id
    group by p.emis
  )
  select ps.emis, sc.name, sc.town, ps.members, ps.confirmed,
         case when ps.confirmed >= 3 then ps.points end,
         case when ps.confirmed >= 3 then round(ps.points::numeric / ps.confirmed, 1) end,
         ps.mine
  from per_school ps
  join public.schools sc on sc.emis = ps.emis
$$;

revoke all on function public.school_table(text, text) from public, anon;
grant execute on function public.school_table(text, text) to authenticated;
