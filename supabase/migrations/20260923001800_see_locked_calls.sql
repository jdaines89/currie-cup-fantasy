-- Seeing your mates' calls, Superbru style.
--
-- Until now any member could read every prediction straight from the API,
-- including calls for matches not yet played; only the app chose not to show
-- them. Now a prediction is visible to:
--
--   its owner, always
--   anyone sharing a pool with the owner in that tournament, once the call is
--   locked: at kickoff in a live season (every call locks then, so nobody
--   can copy), or once the owner locks the round in a replay
--
-- Scores and leaderboards read predictions through security-invoker views,
-- and a call only scores once it is locked, so they are unchanged.

create or replace function public.can_see_prediction(p_entry bigint, p_match text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.owns_entry(p_entry)
      or (public.prediction_locked(p_entry, p_match)
          and exists (
            select 1
            from public.entries e
            join public.pools p on p.season = e.season
            join public.pool_members theirs on theirs.pool_id = p.id and theirs.user_id = e.user_id
            join public.pool_members mine on mine.pool_id = p.id and mine.user_id = auth.uid()
            where e.id = p_entry))
$$;
revoke execute on function public.can_see_prediction(bigint, text) from anon, public;
grant execute on function public.can_see_prediction(bigint, text) to authenticated;

drop policy "members read" on public.predictions;
create policy "own calls, and pool mates' locked calls" on public.predictions for select to authenticated
  using (public.is_member() and public.can_see_prediction(entry_id, match_id));
