-- Fairer school table: each school fields a team sized to the school.
--
-- A school's team is 1 player per 100 learners (EMIS enrolment), at least 3
-- and at most 15, or 5 when the list has no learner count. Its score is the
-- average of its best confirmed players over the whole team, and an empty
-- seat counts as 0. So:
--   * three sharp callers can't beat a big school: a 1,500-learner school
--     fields 15, and three players there leave 12 seats on 0;
--   * a small no-fee school only needs a small team to compete;
--   * confirming another schoolmate never lowers the score (only the best
--     count), so there's no reason to leave weak callers unconfirmed;
--   * until the team is full, every caller who plays adds to the school.
-- Points stay withheld below 3 confirmed players, as before.

create or replace function public.school_seats(p_learners integer)
returns integer
language sql immutable
set search_path = public
as $$
  select case when p_learners is null then 5
              else least(15, greatest(3, ceil(p_learners / 100.0)::int)) end
$$;

drop function public.school_table(text, text);

create function public.school_table(p_season text, p_stage text)
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
    select s.entry_id, sum(s.total_pts)::int as pts
    from public.prediction_scores s
    where s.season = p_season
    group by s.entry_id
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

revoke all on function public.school_table(text, text) from public, anon;
grant execute on function public.school_table(text, text) to authenticated;
