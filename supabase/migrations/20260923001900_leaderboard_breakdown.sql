-- Where each total comes from. The four parts are summed before the Banker
-- doubles anything; banker_pts is the extra the Banker added. So
-- res + mar + cls + exa + banker = total, always.
create or replace view public.pool_leaderboard with (security_invoker = true) as
select pm.pool_id, pm.user_id, mb.display_name as manager, e.id as entry_id, e.team_name,
       coalesce(sum(s.total_pts), 0)                        as total_points,
       count(s.match_id) filter (where s.right_result)      as right_results,
       count(s.match_id) filter (where s.exact_pts > 0)     as exact_scores,
       count(distinct s.round)                              as rounds_scored,
       coalesce(sum(s.result_pts), 0)                       as res_pts,
       coalesce(sum(s.margin_pts), 0)                       as mar_pts,
       coalesce(sum(s.near_pts), 0)                         as cls_pts,
       coalesce(sum(s.exact_pts), 0)                        as exa_pts,
       coalesce(sum(s.total_pts - s.result_pts - s.margin_pts - s.near_pts - s.exact_pts), 0) as banker_pts,
       count(s.match_id)                                    as matches_scored
from public.pool_members pm
join public.pools p on p.id = pm.pool_id
join public.members mb on mb.user_id = pm.user_id
left join public.entries e on e.user_id = pm.user_id and e.season = p.season
left join public.prediction_scores s on s.entry_id = e.id
group by pm.pool_id, pm.user_id, mb.display_name, e.id, e.team_name;
