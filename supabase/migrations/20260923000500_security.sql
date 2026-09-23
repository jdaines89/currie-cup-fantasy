-- Who can see and do what. Row-level security on every table.
--
--   Not signed in (anon):  nothing at all.
--   Signed-in member:      read everything in the league; write only their
--                          own entry, picks, predictions and round locks.
--   Service role (ingest): everything; it bypasses RLS by design.
--
-- Being signed in is not enough on its own: the account must also be in
-- public.members, which only an invite creates.

create or replace function public.is_member()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.members where user_id = auth.uid())
$$;

create or replace function public.owns_entry(p_entry bigint)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.entries where id = p_entry and user_id = auth.uid())
$$;

do $$
declare t text;
begin
  foreach t in array array['seasons','teams','matches','season_bonus_points','players',
                           'player_match_stats','members','entries','pool_picks',
                           'predictions','squad_picks','round_locks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- Reference data (seasons, teams, matches, players, stats, bonus points) has
-- no write policies: only the ingest job, as service role, changes it.
revoke insert, update, delete on public.seasons, public.teams, public.matches,
  public.season_bonus_points, public.players, public.player_match_stats from authenticated;

-- Members can rename themselves, nothing else about their row.
revoke insert, update, delete on public.members from authenticated;
grant update (display_name) on public.members to authenticated;
create policy "members rename themselves" on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own entry" on public.entries for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
create policy "own entry rename" on public.entries for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.entries from authenticated;
grant update (team_name) on public.entries to authenticated;

do $$
declare t text;
begin
  foreach t in array array['pool_picks','predictions','squad_picks']
  loop
    execute format('create policy "own picks in" on public.%I for insert to authenticated with check (public.owns_entry(entry_id))', t);
    execute format('create policy "own picks change" on public.%I for update to authenticated using (public.owns_entry(entry_id)) with check (public.owns_entry(entry_id))', t);
    execute format('create policy "own picks out" on public.%I for delete to authenticated using (public.owns_entry(entry_id))', t);
  end loop;
end $$;

-- Locking a round in is one-way: insert only.
create policy "lock own round" on public.round_locks for insert to authenticated
  with check (public.owns_entry(entry_id));
revoke update, delete on public.round_locks from authenticated;

-- Views: members only; anon gets nothing.
revoke all on public.pool_pick_scores, public.prediction_scores, public.standings,
  public.round_totals, public.leaderboard from anon;
grant select on public.pool_pick_scores, public.prediction_scores, public.standings,
  public.round_totals, public.leaderboard to authenticated;

revoke execute on function public.is_member(), public.owns_entry(bigint),
  public.round_locked(bigint, text, int) from anon;
