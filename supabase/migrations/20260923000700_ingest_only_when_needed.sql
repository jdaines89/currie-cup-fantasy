-- Fetch only when something can have changed.
--
-- Polling every round of the season every hour asks TheSportsDB the same
-- question over and over. Now:
--
--   every 15 minutes   rounds with a match that kicked off in the last six
--                      hours, or kicked off with no score yet (not postponed)
--   daily at 03:00 UTC every round of each live season, to catch fixture moves
--
-- Outside match days the 15-minute job selects nothing and makes no calls.
-- Replay seasons still aren't polled; raw.request_rounds('2026') re-checks one.

create or replace function raw.request_rounds(p_season text default null, p_all boolean default false)
returns int
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  t record;
  n int := 0;
  rid bigint;
begin
  for t in
    select distinct s.id as season, r.round
    from public.seasons s
    cross join lateral (
      select generate_series(1, greatest(coalesce((select max(round) from public.matches where season = s.id), 0), 7)) as round
    ) r
    where ((p_season is null and not s.is_replay) or s.id = p_season)
      and (p_all or p_season is not null or exists (
        select 1 from public.matches m
        where m.season = s.id and m.round = r.round
          and (m.kickoff_at between now() - interval '6 hours' and now()
               or (m.kickoff_at < now() and m.home_score is null and m.status <> 'POSTP'))))
  loop
    rid := net.http_get(
      url := 'https://www.thesportsdb.com/api/v1/json/3/eventsround.php',
      params := jsonb_build_object('id', '5069', 'r', t.round::text, 's', t.season)
    );
    insert into raw.pending_requests (request_id, endpoint, params)
    values (rid, 'eventsround.php', jsonb_build_object('id', '5069', 'r', t.round, 's', t.season));
    n := n + 1;
  end loop;
  return n;
end;
$$;

drop function if exists raw.request_rounds(text);
revoke all on function raw.request_rounds(text, boolean) from public, anon, authenticated;

select cron.unschedule('currie-cup-request-rounds');
select cron.unschedule('currie-cup-collect-responses');
select cron.schedule('currie-cup-request-live', '*/15 * * * *', $$select raw.request_rounds()$$);
select cron.schedule('currie-cup-request-daily', '0 3 * * *', $$select raw.request_rounds(null, true)$$);
select cron.schedule('currie-cup-collect', '2-59/15 * * * *', $$select * from raw.collect_responses()$$);
