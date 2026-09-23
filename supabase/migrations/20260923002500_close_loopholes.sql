-- Security review, 2026-09-23: three things a member could do through the
-- API that the app never lets them do.

-- 1. A call can't be moved to another match or entry. The lock check only
--    looked at the new match, so a call that had kicked off could be moved
--    onto an open match, which quietly deleted a bad call.
create or replace function public.check_prediction()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record := coalesce(new, old);
  m public.matches;
begin
  if tg_op = 'UPDATE' and (new.entry_id <> old.entry_id or new.match_id <> old.match_id) then
    raise exception 'A call can''t be moved to another match' using errcode = 'P0001';
  end if;
  select * into m from public.matches where id = r.match_id;
  if public.prediction_locked(r.entry_id, r.match_id) then
    raise exception 'That match is locked' using errcode = 'P0001';
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

-- 2. Timestamps and codes come from the database, not the phone: members
--    could post chat dated in the future (pinned to the bottom), backdate a
--    lock, or pick their own pool code. Inserts now name the columns the app
--    actually sends.
revoke insert on public.chat_messages, public.match_locks, public.round_locks,
                 public.pools, public.entries from anon, authenticated;
grant insert (pool_id, author_id, body)     on public.chat_messages to authenticated;
grant insert (entry_id, match_id)           on public.match_locks   to authenticated;
grant insert (entry_id, season, round)      on public.round_locks   to authenticated;
grant insert (season, name, created_by)     on public.pools         to authenticated;
grant insert (user_id, season, team_name)   on public.entries       to authenticated;

-- 3. Display names: the profile page limits them to 24 characters and checks
--    they're unique, but only in the app. Now the database does too, so
--    nobody can take a mate's name or post a name the size of an essay.
alter table public.members
  add constraint members_display_name_length
  check (length(btrim(display_name)) between 1 and 24);
create unique index members_display_name_unique on public.members (lower(btrim(display_name)));
