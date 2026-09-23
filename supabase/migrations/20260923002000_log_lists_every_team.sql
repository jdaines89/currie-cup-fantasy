-- The log lists every team in the tournament from the start, on zero, rather
-- than only teams that have played. A tournament's teams are the ones in its
-- fixtures. Ties before a ball is kicked fall back to team name.
create or replace view public.standings with (security_invoker = true) as
with entrants as (
  select season, home_team_id as team_id from public.matches
  union
  select season, away_team_id from public.matches
), sides as (
  select season, home_team_id as team_id, home_score as pf, away_score as pa
  from public.matches where status in ('FT', 'INTR') and home_score is not null
  union all
  select season, away_team_id, away_score, home_score
  from public.matches where status in ('FT', 'INTR') and home_score is not null
), agg as (
  select en.season, en.team_id,
         count(s.pf)                                                   as played,
         count(*) filter (where s.pf > s.pa)                          as won,
         count(*) filter (where s.pf = s.pa)                          as drawn,
         count(*) filter (where s.pf < s.pa)                          as lost,
         coalesce(sum(s.pf), 0)                                        as points_for,
         coalesce(sum(s.pa), 0)                                        as points_against,
         count(*) filter (where s.pa - s.pf between 1 and 7)          as losing_bonus
  from entrants en
  left join sides s on s.season = en.season and s.team_id = en.team_id
  group by en.season, en.team_id
), pts as (
  select a.*, a.points_for - a.points_against as diff,
         a.won * 4 + a.drawn * 2 as match_points,
         b.bonus_points is not null as points_exact,
         a.won * 4 + a.drawn * 2 + coalesce(b.bonus_points::bigint, a.losing_bonus) as log_points
  from agg a
  left join public.season_bonus_points b on b.season = a.season and b.team_id = a.team_id
), ranked as (
  select pts.*, bool_and(points_exact) over (partition by season) as season_exact
  from pts
)
select r.season, r.team_id, r.played, r.won, r.drawn, r.lost, r.points_for, r.points_against,
       r.diff, r.log_points, r.points_exact,
       row_number() over (partition by r.season
         order by (case when r.season_exact then r.log_points else r.match_points end) desc,
                  r.diff desc, r.points_for desc, t.display_name) as position
from ranked r
left join public.teams t on t.id = r.team_id;
