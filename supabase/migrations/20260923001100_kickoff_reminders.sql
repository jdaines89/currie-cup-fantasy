-- Reminder emails an hour before kickoff, to anyone who hasn't called the
-- score yet.
--
-- 1. In a live season each match now locks at its own kickoff, not the
--    round's first: a reminder for Saturday's match is no use if Friday's
--    kickoff already shut the round. A replay season still locks by round.
-- 2. notify.due_reminders() is the query: who, for which matches. Plain SQL,
--    testable anywhere.
-- 3. notify.send_reminders() sends one email per person through Brevo's
--    free API (pg_net, like the results feed) and records each match in
--    notify.reminders_sent, so nobody is reminded twice. The Brevo key lives
--    in Supabase Vault, never in the repo; with no key it sends nothing.
-- pg_cron runs it every five minutes, so a reminder lands 55-60 minutes out.

-- 1. Per-match locking in live seasons.
create or replace function public.prediction_locked(p_entry bigint, p_match text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select case when s.is_replay then public.round_locked(p_entry, m.season, m.round)
              else m.kickoff_at <= now() end
  from public.matches m join public.seasons s on s.id = m.season
  where m.id = p_match
$$;
revoke execute on function public.prediction_locked(bigint, text) from anon, public;
grant execute on function public.prediction_locked(bigint, text) to authenticated;

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
  if public.prediction_locked(r.entry_id, r.match_id) then
    raise exception 'That match is locked' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- Moving the Banker clears it off the old match, which must still be open.
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

-- 2. Who wants reminders.
alter table public.members add column email_reminders boolean not null default true;
grant update (email_reminders) on public.members to authenticated;

create schema if not exists notify;
revoke all on schema notify from public, anon, authenticated;

-- Not secret, so a table rather than Vault. The sender must be verified in Brevo.
create table notify.settings (
  key   text primary key,
  value text not null
);
insert into notify.settings (key, value) values
  ('sender_email', 'sender@example.com'),  -- the real sender is set in the live database, not here
  ('sender_name',  'Currie Cup Fantasy'),
  ('app_url',      'https://jdaines89.github.io/currie-cup-fantasy/predict/');

create table notify.reminders_sent (
  user_id    uuid not null references public.members(user_id) on delete cascade,
  match_id   text not null references public.matches(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  request_id bigint,                                   -- pg_net request, for tracing
  primary key (user_id, match_id)
);

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
  cross join public.members mb
  where m.kickoff_at > p_now and m.kickoff_at <= p_now + interval '60 minutes'
    and m.status = 'SCHEDULED'
    and mb.email_reminders
    and not exists (select 1 from public.predictions p join public.entries e on e.id = p.entry_id
                    where e.user_id = mb.user_id and e.season = m.season and p.match_id = m.id)
    and not exists (select 1 from notify.reminders_sent r where r.user_id = mb.user_id and r.match_id = m.id)
  group by mb.user_id, mb.email, mb.display_name
$$;

-- 3. Sending.
create or replace function notify.send_reminders()
returns int
language plpgsql
security definer
set search_path = public, notify
as $$
declare
  key text;
  d record;
  rid bigint;
  n int := 0;
  cfg jsonb := (select jsonb_object_agg(s.key, s.value) from notify.settings s);
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'brevo_api_key';
  if key is null then return 0; end if;
  for d in select * from notify.due_reminders() loop
    rid := net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object('api-key', key, 'content-type', 'application/json', 'accept', 'application/json'),
      body := jsonb_build_object(
        'sender', jsonb_build_object('email', cfg ->> 'sender_email', 'name', cfg ->> 'sender_name'),
        'to', jsonb_build_array(jsonb_build_object('email', d.email, 'name', d.display_name)),
        'subject', case when cardinality(d.match_ids) = 1 then 'Kickoff in under an hour: call your score'
                        else 'Kickoff in under an hour: ' || cardinality(d.match_ids) || ' scores to call' end,
        'htmlContent',
          '<p>Hi ' || replace(replace(replace(d.display_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ',</p>'
          || '<p>You haven''t called a score for:</p><ul><li>'
          || array_to_string(d.lines, '</li><li>')
          || '</li></ul><p>Times are SA time. <a href="' || (cfg ->> 'app_url') || '">Call it now</a> before it locks at kickoff.</p>'
          || '<p style="color:#888;font-size:12px">You can turn these off on the Predict screen.</p>'
      )
    );
    insert into notify.reminders_sent (user_id, match_id, request_id)
    select d.user_id, x, rid from unnest(d.match_ids) x
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on all functions in schema notify from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('currie-cup-kickoff-reminders', '*/5 * * * *', 'select notify.send_reminders()');
  end if;
end $$;
