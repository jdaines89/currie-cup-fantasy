-- The crowd: how every player in a tournament called each match.
--
-- Counts all entries in the season, not just your pools, so it only ever
-- returns totals, never who called what. Two rules keep it fair:
--   * you see a match's crowd only once your own call on it can't change
--     (kickoff, your early lock, or your locked round in a replay), so the
--     crowd can't be copied;
--   * it only counts calls that are themselves locked, so an open call is
--     never revealed, even as part of a total.
-- Below 3 calls the split is withheld (only the count comes back), so a tiny
-- crowd can't be reverse-engineered into one person's call.

create or replace function public.match_crowd(p_season text)
returns table (
  match_id   text,
  calls      int,
  home_wins  int,
  draws      int,
  away_wins  int,
  avg_home   numeric,
  avg_away   numeric,
  top_home   int,
  top_away   int,
  top_calls  int
)
language sql stable
security definer
set search_path = public
as $$
  with mine as (
    select e.id from public.entries e where e.user_id = auth.uid() and e.season = p_season
  ), open_to_me as (
    select m.id
    from public.matches m
    join public.seasons s on s.id = m.season
    where m.season = p_season and public.is_member()
      and (case when s.is_replay
                then exists (select 1 from mine where public.round_locked(mine.id, m.season, m.round))
                else m.kickoff_at <= now()
                     or exists (select 1 from mine join public.match_locks l on l.entry_id = mine.id and l.match_id = m.id) end)
  ), calls as (
    select p.match_id, p.home_score, p.away_score
    from public.predictions p
    join open_to_me o on o.id = p.match_id
    where public.prediction_locked(p.entry_id, p.match_id)
  ), top as (
    select distinct on (match_id) match_id, home_score, away_score, count(*)::int as n
    from calls group by match_id, home_score, away_score
    order by match_id, count(*) desc, home_score desc, away_score
  )
  select c.match_id,
         count(*)::int,
         case when count(*) >= 3 then (count(*) filter (where c.home_score > c.away_score))::int end,
         case when count(*) >= 3 then (count(*) filter (where c.home_score = c.away_score))::int end,
         case when count(*) >= 3 then (count(*) filter (where c.home_score < c.away_score))::int end,
         case when count(*) >= 3 then round(avg(c.home_score), 1) end,
         case when count(*) >= 3 then round(avg(c.away_score), 1) end,
         case when count(*) >= 3 then t.home_score end,
         case when count(*) >= 3 then t.away_score end,
         case when count(*) >= 3 then t.n end
  from calls c join top t on t.match_id = c.match_id
  group by c.match_id, t.home_score, t.away_score, t.n
$$;

revoke all on function public.match_crowd(text) from public, anon;
grant execute on function public.match_crowd(text) to authenticated;
