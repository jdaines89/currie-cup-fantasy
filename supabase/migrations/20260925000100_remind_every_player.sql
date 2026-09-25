-- Reminders go to anyone playing the tournament, pool or no pool. Calls
-- belong to your team for the tournament; a pool only decides who you're
-- compared with. Someone who named a team and called a game but hadn't
-- joined a pool yet was missing their reminders.
create or replace function notify.due_reminders(p_now timestamptz default now())
returns table (user_id uuid, email text, display_name text, match_ids text[], lines text[])
language sql stable
set search_path = public, notify
as $$
  select mb.user_id, mb.email, mb.display_name,
         array_agg(m.id order by m.kickoff_at),
         array_agg(to_char(m.kickoff_at at time zone 'Africa/Johannesburg', 'HH24:MI') || '  '
                   || h.display_name || ' v ' || a.display_name order by m.kickoff_at)
  from public.matches m
  join public.seasons s on s.id = m.season and not s.is_replay
  join public.teams h on h.id = m.home_team_id
  join public.teams a on a.id = m.away_team_id
  join public.members mb on mb.email_reminders
    and (exists (select 1 from public.pool_members pm join public.pools p on p.id = pm.pool_id
                 where pm.user_id = mb.user_id and p.season = m.season)
         or exists (select 1 from public.entries e where e.user_id = mb.user_id and e.season = m.season))
  where m.kickoff_at > p_now and m.kickoff_at <= p_now + interval '60 minutes'
    and m.status = 'SCHEDULED'
    and not exists (select 1 from public.predictions pr join public.entries e on e.id = pr.entry_id
                    where e.user_id = mb.user_id and e.season = m.season and pr.match_id = m.id)
    and not exists (select 1 from notify.reminders_sent r where r.user_id = mb.user_id and r.match_id = m.id)
  group by mb.user_id, mb.email, mb.display_name
$$;
