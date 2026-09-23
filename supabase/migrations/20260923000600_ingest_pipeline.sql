-- Live results, fetched by the database itself: no server, no secrets.
--
--   raw.request_rounds()    every hour: asks TheSportsDB for each round of
--                           every live season (pg_net, asynchronous)
--   raw.collect_responses() five minutes later: lands each answer verbatim in
--                           raw.feed_payloads, then rebuilds core from it
--
-- The raw layer dedupes identical payloads, so an unchanged round costs one
-- row lookup and changes nothing downstream. Replay seasons aren't polled;
-- run raw.request_rounds('2026') by hand to re-check one.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table raw.pending_requests (
  request_id   bigint primary key,
  endpoint     text   not null,
  params       jsonb  not null,
  requested_at timestamptz not null default now()
);

create or replace function raw.request_rounds(p_season text default null)
returns int
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  s record;
  r int;
  n int := 0;
  rid bigint;
begin
  for s in
    select id from public.seasons
    where (p_season is null and not is_replay) or id = p_season
  loop
    for r in select generate_series(1, greatest(coalesce((select max(round) from public.matches where season = s.id), 0), 7))
    loop
      rid := net.http_get(
        url := 'https://www.thesportsdb.com/api/v1/json/3/eventsround.php',
        params := jsonb_build_object('id', '5069', 'r', r::text, 's', s.id)
      );
      insert into raw.pending_requests (request_id, endpoint, params)
      values (rid, 'eventsround.php', jsonb_build_object('id', '5069', 'r', r, 's', s.id));
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;

create or replace function raw.collect_responses()
returns table (requests int, landed int, matches_changed int)
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  p record;
  new_id bigint;
begin
  requests := 0; landed := 0; matches_changed := 0;
  for p in
    select q.request_id, q.endpoint, q.params, resp.status_code, resp.content
    from raw.pending_requests q
    join net._http_response resp on resp.id = q.request_id
  loop
    requests := requests + 1;
    if p.status_code = 200 and p.content is not null and p.content <> '' then
      insert into raw.feed_payloads (source, endpoint, params, payload)
      values ('thesportsdb', p.endpoint, p.params, p.content::jsonb)
      on conflict do nothing
      returning id into new_id;
      if new_id is not null then
        landed := landed + 1;
        matches_changed := matches_changed + public.core_load_events(new_id);
      end if;
    end if;
    delete from raw.pending_requests where request_id = p.request_id;
  end loop;
  -- Requests pg_net never answered (it keeps responses for a few hours).
  delete from raw.pending_requests where requested_at < now() - interval '1 day';
  return next;
end;
$$;

revoke all on function raw.request_rounds(text), raw.collect_responses() from public, anon, authenticated;
revoke all on raw.pending_requests from public, anon, authenticated;

select cron.schedule('currie-cup-request-rounds', '0 * * * *', $$select raw.request_rounds()$$);
select cron.schedule('currie-cup-collect-responses', '5 * * * *', $$select * from raw.collect_responses()$$);
