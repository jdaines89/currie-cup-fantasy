-- Layer 4: marts. What the app reads: scores, the log and the leaderboard.
--
-- Plain views over core and league, so they are never stale and never need a
-- rescore job. security_invoker makes each view run with the reader's own
-- permissions, so the row-level security on the tables underneath applies.
--
-- A match counts once it has a result: full time, or interrupted with the
-- score standing (Sharks v Boland, round 4 of 2026, stood at 19-12 and counts
-- on the official log).
--
-- A score only shows once its round is locked (for a replay season, once
-- that member has locked it in), so nobody sees points for picks they can
-- still change.

-- Union Pool, one row per pick. Mirrors scorePoolPick() in src/lib/scoring.ts:
-- 10 a win, 5 a draw, +1 per 5 scored, -1 per 10 conceded, +5 for winning by
-- 15 or more, +3 for losing by 7 or less, doubled for the captain.
create view public.pool_pick_scores with (security_invoker = true) as
with played as (
  select p.entry_id, p.season, p.round, p.team_id, p.is_captain, m.id as match_id,
         case when m.home_team_id = p.team_id then m.home_score else m.away_score end as scored,
         case when m.home_team_id = p.team_id then m.away_score else m.home_score end as conceded
  from public.pool_picks p
  join public.matches m
    on m.season = p.season and m.round = p.round
   and p.team_id in (m.home_team_id, m.away_team_id)
  where m.status in ('FT', 'INTR') and m.home_score is not null
    and public.round_locked(p.entry_id, p.season, p.round)
), parts as (
  select *,
         case when scored > conceded then 10 when scored = conceded then 5 else 0 end as result_pts,
         floor(scored / 5.0)::int                                                   as attack_pts,
         -floor(conceded / 10.0)::int                                               as defence_pts,
         case when scored - conceded >= 15 then 5
              when conceded - scored between 1 and 7 then 3 else 0 end              as bonus_pts
  from played
)
select entry_id, season, round, team_id, match_id, is_captain, scored, conceded,
       result_pts, attack_pts, defence_pts, bonus_pts,
       result_pts + attack_pts + defence_pts + bonus_pts                             as base_pts,
       (result_pts + attack_pts + defence_pts + bonus_pts) * (case when is_captain then 2 else 1 end) as total_pts
from parts;

-- Score predictions, one row per prediction. Mirrors scorePred() in
-- docs/index.html: 6 for the right result, +5 for the exact margin, +2 per
-- side within 3 points, +10 for the exact score.
create view public.prediction_scores with (security_invoker = true) as
with played as (
  select pr.entry_id, m.season, m.round, pr.match_id,
         pr.home_score as pred_home, pr.away_score as pred_away,
         m.home_score as real_home, m.away_score as real_away,
         sign(pr.home_score - pr.away_score) = sign(m.home_score - m.away_score) as right_result
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  join public.entries e on e.id = pr.entry_id
  where m.status in ('FT', 'INTR') and m.home_score is not null
    and public.round_locked(pr.entry_id, m.season, m.round)
), parts as (
  select *,
         case when right_result then 6 else 0 end                                            as result_pts,
         case when right_result and pred_home - pred_away = real_home - real_away then 5 else 0 end as margin_pts,
         (case when abs(pred_home - real_home) <= 3 then 2 else 0 end) +
         (case when abs(pred_away - real_away) <= 3 then 2 else 0 end)                       as near_pts,
         case when pred_home = real_home and pred_away = real_away then 10 else 0 end         as exact_pts
  from played
)
select entry_id, season, round, match_id, pred_home, pred_away, real_home, real_away,
       right_result, result_pts, margin_pts, near_pts, exact_pts,
       result_pts + margin_pts + near_pts + exact_pts as total_pts
from parts;

-- The Currie Cup log. Mirrors buildLog() in src/lib/standings.ts, including
-- its ranking rule: on log points when the season's published bonus points
-- are on file for every union, otherwise on win/draw match points, then
-- points difference, then points scored.
create view public.standings with (security_invoker = true) as
with sides as (
  select season, home_team_id as team_id, home_score as pf, away_score as pa from public.matches where status in ('FT', 'INTR') and home_score is not null
  union all
  select season, away_team_id, away_score, home_score from public.matches where status in ('FT', 'INTR') and home_score is not null
), agg as (
  select season, team_id,
         count(*)                                  as played,
         count(*) filter (where pf > pa)           as won,
         count(*) filter (where pf = pa)           as drawn,
         count(*) filter (where pf < pa)           as lost,
         sum(pf)                                   as points_for,
         sum(pa)                                   as points_against,
         count(*) filter (where pa - pf between 1 and 7) as losing_bonus
  from sides group by season, team_id
), pts as (
  select a.*, a.points_for - a.points_against as diff,
         a.won * 4 + a.drawn * 2                   as match_points,
         b.bonus_points is not null                as points_exact,
         a.won * 4 + a.drawn * 2 + coalesce(b.bonus_points, a.losing_bonus) as log_points
  from agg a
  left join public.season_bonus_points b on b.season = a.season and b.team_id = a.team_id
), ranked as (
  select *, bool_and(points_exact) over (partition by season) as season_exact from pts
)
select season, team_id, played, won, drawn, lost, points_for, points_against, diff,
       log_points, points_exact,
       row_number() over (partition by season order by
         case when season_exact then log_points else match_points end desc,
         diff desc, points_for desc) as position
from ranked;

-- Every entry's total per round and game.
create view public.round_totals with (security_invoker = true) as
select entry_id, season, round, 'pool' as game, sum(total_pts) as points
from public.pool_pick_scores group by entry_id, season, round
union all
select entry_id, season, round, 'predict', sum(total_pts)
from public.prediction_scores group by entry_id, season, round;

create view public.leaderboard with (security_invoker = true) as
select e.id as entry_id, e.season, e.team_name, m.display_name as manager,
       coalesce(sum(t.points) filter (where t.game = 'pool'), 0)    as pool_points,
       coalesce(sum(t.points) filter (where t.game = 'predict'), 0) as predict_points,
       coalesce(sum(t.points), 0)                                    as total_points,
       count(distinct t.round)                                       as rounds_scored
from public.entries e
join public.members m on m.user_id = e.user_id
left join public.round_totals t on t.entry_id = e.id
group by e.id, e.season, e.team_name, m.display_name;
