-- One game instead of two.
--
-- The Union Pool and score predictions asked the same question twice: who
-- wins each match. Predictions stay, and the pool's one good idea, the
-- captain, carries over as the Banker: one prediction a round that you back
-- to count double. The pool's table is kept, unread, until its picks are
-- cleared out.

alter table public.predictions add column is_banker boolean not null default false;

-- One Banker per entry per round: backing a new match moves it there.
create or replace function public.check_prediction()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  m public.matches;
begin
  select * into m from public.matches where id = r.match_id;
  if public.round_locked(r.entry_id, m.season, m.round) then
    raise exception 'Round % is locked', m.round using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.is_banker then
    update public.predictions p set is_banker = false
    from public.matches o
    where p.entry_id = new.entry_id and p.is_banker and p.match_id <> new.match_id
      and o.id = p.match_id and o.season = m.season and o.round = m.round;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- The leaderboard now reads predictions only. It is a view, so replacing it
-- loses nothing.
drop view public.leaderboard;
drop view public.round_totals;

-- Scoring as before, doubled for the Banker.
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
         case when pred_home = real_home and pred_away = real_away then 10 else 0 end         as exact_pts
  from played
)
select entry_id, season, round, match_id, pred_home, pred_away, real_home, real_away,
       right_result, result_pts, margin_pts, near_pts, exact_pts,
       (result_pts + margin_pts + near_pts + exact_pts) * (case when is_banker then 2 else 1 end) as total_pts,
       is_banker
from parts;

create view public.leaderboard with (security_invoker = true) as
select e.id as entry_id, e.season, e.team_name, m.display_name as manager,
       coalesce(sum(s.total_pts), 0)                        as total_points,
       count(s.match_id) filter (where s.right_result)      as right_results,
       count(s.match_id) filter (where s.exact_pts > 0)     as exact_scores,
       count(distinct s.round)                              as rounds_scored
from public.entries e
join public.members m on m.user_id = e.user_id
left join public.prediction_scores s on s.entry_id = e.id
group by e.id, e.season, e.team_name, m.display_name;

revoke all on public.prediction_scores, public.leaderboard from anon;
grant select on public.prediction_scores, public.leaderboard to authenticated;
