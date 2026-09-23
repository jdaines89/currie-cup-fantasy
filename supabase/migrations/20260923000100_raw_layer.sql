-- Layer 1: raw. Every response the feed ever gave us, untouched.
--
-- Append-only: nothing updates or deletes here, so any number in the app can
-- be traced back to the exact payload it came from, and the core layer can be
-- rebuilt from scratch if a transform turns out to be wrong. Not exposed to
-- the API: only the ingest job (service role) reads or writes it.

create schema if not exists raw;

create table raw.feed_payloads (
  id           bigint generated always as identity primary key,
  source       text        not null,                 -- 'thesportsdb' | 'seed' | 'wikipedia'
  endpoint     text        not null,                 -- e.g. 'eventsround.php'
  params       jsonb       not null default '{}',    -- query params the call used
  payload      jsonb       not null,                 -- response body, verbatim
  payload_hash text        generated always as (md5(payload::text)) stored,
  fetched_at   timestamptz not null default now()
);

-- A poll that returns the same body as last time adds nothing: keep one copy.
create unique index feed_payloads_dedupe on raw.feed_payloads (source, endpoint, params, payload_hash);
create index feed_payloads_recent on raw.feed_payloads (source, endpoint, fetched_at desc);

revoke all on schema raw from public, anon, authenticated;
