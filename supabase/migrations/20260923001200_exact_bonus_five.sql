-- Exact score bonus 10 -> 5.
--
-- A rugby exact score is mostly luck. At +10 an exact call on a Banker was
-- worth 50, enough for one lucky match to decide a season; at +5 it is 20
-- (40 on a Banker) against 15 for a near-perfect call, so right results and
-- margins decide more of the table. A view, so every round rescores itself.

-- Same as before, with the exact bonus at 5.
create or replace view public.prediction_scores with (security_invoker = true) as
with played as (
  select pr.entry_id, m.season, m.round, pr.match_id, pr.is_banker,
         pr.home_score as pred_home, pr.away_score as pred_away,
         m.home_score as real_home, m.away_score as real_away,
         sign(pr.home_score - pr.away_score) = sign(m.home_score - m.away_score) as right_result
  from public.predictions pr
  join public.matches m on m.id = pr.match_id
  where m.status in ('FT', 'INTR') and m.home_score is not null
    and public.round_locked(pr.entry_id, m.season, m.round)
), parts as (
  select *,
         case when right_result then 6 else 0 end                                            as result_pts,
         case when right_result and pred_home - pred_away = real_home - real_away then 5 else 0 end as margin_pts,
         (case when abs(pred_home - real_home) <= 3 then 2 else 0 end) +
         (case when abs(pred_away - real_away) <= 3 then 2 else 0 end)                       as near_pts,
         case when pred_home = real_home and pred_away = real_away then 5 else 0 end          as exact_pts
  from played
)
select entry_id, season, round, match_id, pred_home, pred_away, real_home, real_away,
       right_result, result_pts, margin_pts, near_pts, exact_pts,
       (result_pts + margin_pts + near_pts + exact_pts) * (case when is_banker then 2 else 1 end) as total_pts,
       is_banker
from parts;
