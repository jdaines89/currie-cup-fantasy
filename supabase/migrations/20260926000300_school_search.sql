-- School search that finds schools the way people say them.
--
-- The government list uses official names ("Hoër Jongenskool Paarl",
-- "Grey-Kollege S/S"), so each school can carry nicknames and English names
-- (schools.aka), and search ignores accents, apostrophes and punctuation and
-- understands the list's short forms (S/S, P/S, HTS). Bigger schools come
-- first when several match.

alter table public.schools add column aka text[] not null default '{}';

-- Lower case, no accents or punctuation, short forms spelled out.
create or replace function public.school_key(p text)
returns text
language sql immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(translate(lower(coalesce(p, '')), 'êëéèôöüûáàïîç’', 'eeeeoouuaaiic'''),
        '\ms/s\M', ' sekondere skool secondary high school ', 'g'),
        '\mp/s\M', ' primere skool primary school ', 'g'),
        '\mhts\M', ' hoer tegniese skool technical high school ', 'g'),
      '[^a-z0-9 ]+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

create or replace function public.search_schools(p_query text, p_stage text)
returns setof public.schools
language sql stable
set search_path = public
as $$
  with q as (select school_key(p_query) as k),
  words as (select '%' || w || '%' as pat from q, regexp_split_to_table(q.k, ' ') w where w <> '')
  select s.*
  from public.schools s, q
  where (case p_stage when 'primary' then s.offers_primary else s.offers_matric end)
    and length(q.k) >= 3
    and school_key(s.name || ' ' || array_to_string(s.aka, ' ')) like all (select pat from words)
  order by (school_key(s.name) like q.k || '%' or exists (select 1 from unnest(s.aka) a where school_key(a) like q.k || '%')) desc,
           s.learners desc nulls last, s.name
  limit 8
$$;

revoke all on function public.search_schools(text, text) from public, anon;
grant execute on function public.search_schools(text, text) to authenticated;
