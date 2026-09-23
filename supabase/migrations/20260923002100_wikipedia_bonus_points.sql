-- Bonus points without anyone typing them in.
--
-- The log gives 1 point for losing by 7 or less (worked out from the score
-- the moment a result lands) and 1 for scoring 4+ tries. TheSportsDB's free
-- feed has no try counts (checked 2026-09-23: event, event-stats and
-- league-table endpoints are all empty for rugby), but Wikipedia's season
-- article keeps the log as structured wikitext, one field per number:
--
--   | win_GLA = 13 | draw_GLA = 0 | loss_GLA = 5 | ... | tb_GLA = 11 | lb_GLA = 2
--
-- So, every two hours for each live season with a wiki_page:
--   raw.request_wiki()          asks Wikipedia's API for the article wikitext
--   raw.collect_responses()     lands it verbatim in raw.feed_payloads
--                               (source 'wikipedia'; unchanged text dedupes)
--   core_load_wiki_log(raw_id)  parses the league table into published_log
--
-- The log then uses our own losing bonus plus Wikipedia's try-bonus count.
-- A team's points are marked exact once Wikipedia's games played matches
-- ours; until then its try bonus for the newest match is still to come.

alter table public.seasons add column wiki_page text;
update public.seasons set wiki_page = '2026–27 United Rugby Championship' where id = 'urc-2026-27';

create table public.published_log (
  season       text not null references public.seasons(id),
  team_id      text not null references public.teams(id),
  played       int  not null,
  won          int  not null,
  drawn        int  not null,
  lost         int  not null,
  try_bonus    int  not null,
  losing_bonus int  not null,
  raw_id       bigint not null references raw.feed_payloads(id),
  loaded_at    timestamptz not null default now(),
  primary key (season, team_id)
);
alter table public.published_log enable row level security;
alter table public.published_log force row level security;
revoke all on public.published_log from anon;
revoke insert, update, delete on public.published_log from authenticated;
grant select on public.published_log to authenticated;
create policy "members read" on public.published_log for select to authenticated using (public.is_member());

-- Wikitext in, one row per team out. Teams are matched by name: Wikipedia's
-- "Glasgow Warriors" starts with our "Glasgow", and the longest match wins.
create or replace function public.core_load_wiki_log(p_raw_id bigint)
returns int
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  f raw.feed_payloads;
  txt text;
  block text;
  v_season text;
  n int;
begin
  select * into f from raw.feed_payloads where id = p_raw_id;
  v_season := f.params ->> 'season';
  txt := f.payload -> 'parse' ->> 'wikitext';
  if txt is null or position('{{#invoke:sports table' in txt) = 0 then return 0; end if;
  -- The first sports table on the page is the league log.
  block := substring(txt from position('{{#invoke:sports table' in txt));
  block := substring(block from 1 for coalesce(nullif(position(E'\n}}' in block), 0), length(block)));

  with codes as (
    select m[1] as code,
           coalesce(substring(m[2] from '\[\[[^]|]*\|([^]]+)\]\]'), substring(m[2] from '\[\[([^]]+)\]\]'), m[2]) as wname
    from regexp_matches(block, '\|\s*name_([A-Za-z0-9]+)\s*=\s*([^\n]*)', 'g') m
  ), num as (
    select c.code, c.wname,
           (select coalesce(substring(block from '\|\s*' || k || '_' || c.code || '\s*=\s*(\d+)')::int, 0)) as v, k
    from codes c, unnest(array['win', 'draw', 'loss', 'tb', 'lb']) k
  ), wide as (
    select code, wname,
           max(v) filter (where k = 'win') as won, max(v) filter (where k = 'draw') as drawn,
           max(v) filter (where k = 'loss') as lost, max(v) filter (where k = 'tb') as tb,
           max(v) filter (where k = 'lb') as lb
    from num group by code, wname
  ), entrants as (
    select distinct t.id, t.display_name
    from public.matches m join public.teams t on t.id in (m.home_team_id, m.away_team_id)
    where m.season = v_season
  ), matched as (
    select distinct on (w.code) w.*, e.id as team_id
    from wide w join entrants e on lower(trim(w.wname)) like lower(e.display_name) || '%'
    order by w.code, length(e.display_name) desc
  )
  insert into public.published_log as p (season, team_id, played, won, drawn, lost, try_bonus, losing_bonus, raw_id)
  select v_season, team_id, won + drawn + lost, won, drawn, lost, tb, lb, p_raw_id from matched
  on conflict (season, team_id) do update set
    played = excluded.played, won = excluded.won, drawn = excluded.drawn, lost = excluded.lost,
    try_bonus = excluded.try_bonus, losing_bonus = excluded.losing_bonus,
    raw_id = excluded.raw_id, loaded_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.core_load_wiki_log(bigint) from public, anon, authenticated;

create or replace function raw.request_wiki()
returns int
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  s record;
  rid bigint;
  n int := 0;
begin
  for s in select id, wiki_page from public.seasons where wiki_page is not null and not is_replay loop
    rid := net.http_get(
      url := 'https://en.wikipedia.org/w/api.php',
      params := jsonb_build_object('action', 'parse', 'page', s.wiki_page, 'prop', 'wikitext',
                                   'format', 'json', 'formatversion', '2', 'redirects', '1'),
      headers := '{"User-Agent": "Scrumline/1.0 (private prediction league; daily log check)"}'::jsonb
    );
    insert into raw.pending_requests (request_id, endpoint, params)
    values (rid, 'wikipedia:parse', jsonb_build_object('page', s.wiki_page, 'season', s.id));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function raw.request_wiki() from public, anon, authenticated;

-- The collector now knows two sources.
create or replace function raw.collect_responses()
returns table (requests int, landed int, matches_changed int)
language plpgsql
security definer
set search_path = public, raw
as $$
declare
  p record;
  new_id bigint;
  wiki boolean;
begin
  requests := 0; landed := 0; matches_changed := 0;
  for p in
    select q.request_id, q.endpoint, q.params, resp.status_code, resp.content
    from raw.pending_requests q
    join net._http_response resp on resp.id = q.request_id
  loop
    requests := requests + 1;
    wiki := p.endpoint like 'wikipedia:%';
    if p.status_code = 200 and p.content is not null and p.content <> '' then
      insert into raw.feed_payloads (source, endpoint, params, payload)
      values (case when wiki then 'wikipedia' else 'thesportsdb' end, p.endpoint, p.params, p.content::jsonb)
      on conflict do nothing
      returning id into new_id;
      if new_id is not null then
        landed := landed + 1;
        if wiki then perform public.core_load_wiki_log(new_id);
        else matches_changed := matches_changed + public.core_load_events(new_id);
        end if;
      end if;
    end if;
    delete from raw.pending_requests where request_id = p.request_id;
  end loop;
  delete from raw.pending_requests where requested_at < now() - interval '1 day';
  return next;
end;
$$;
revoke all on function raw.collect_responses() from public, anon, authenticated;

-- The log: our losing bonus, Wikipedia's try bonus. A season with a
-- published final total (the Currie Cup replay) still uses that.
create or replace view public.standings with (security_invoker = true) as
with entrants as (
  select season, home_team_id as team_id from public.matches
  union
  select season, away_team_id from public.matches
), sides as (
  select season, home_team_id as team_id, home_score as pf, away_score as pa
  from public.matches where status in ('FT', 'INTR') and home_score is not null
  union all
  select season, away_team_id, away_score, home_score
  from public.matches where status in ('FT', 'INTR') and home_score is not null
), agg as (
  select en.season, en.team_id,
         count(s.pf)                                                   as played,
         count(*) filter (where s.pf > s.pa)                          as won,
         count(*) filter (where s.pf = s.pa)                          as drawn,
         count(*) filter (where s.pf < s.pa)                          as lost,
         coalesce(sum(s.pf), 0)                                        as points_for,
         coalesce(sum(s.pa), 0)                                        as points_against,
         count(*) filter (where s.pa - s.pf between 1 and 7)          as losing_bonus
  from entrants en
  left join sides s on s.season = en.season and s.team_id = en.team_id
  group by en.season, en.team_id
), pts as (
  select a.*, a.points_for - a.points_against as diff,
         a.won * 4 + a.drawn * 2 as match_points,
         b.bonus_points is not null or pl.played = a.played as points_exact,
         coalesce(b.bonus_points::bigint, a.losing_bonus + coalesce(pl.try_bonus, 0)) as bonus
  from agg a
  left join public.season_bonus_points b on b.season = a.season and b.team_id = a.team_id
  left join public.published_log pl on pl.season = a.season and pl.team_id = a.team_id
), ranked as (
  select pts.*, pts.match_points + pts.bonus as log_points,
         bool_and(points_exact) over (partition by season) as season_exact
  from pts
)
select r.season, r.team_id, r.played, r.won, r.drawn, r.lost, r.points_for, r.points_against,
       r.diff, r.log_points, r.points_exact,
       row_number() over (partition by r.season
         order by r.log_points desc, r.diff desc, r.points_for desc, t.display_name) as position,
       r.bonus as bonus_points
from ranked r
left join public.teams t on t.id = r.team_id;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('wiki-request', '17 */2 * * *', 'select raw.request_wiki()');
  end if;
end $$;
