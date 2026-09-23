-- The United Rugby Championship 2026-27, a live season.
--
-- Teams are listed here with the names the feed uses, so the ingest matches
-- them, plus the name we show, a short code and jersey colours picked by hand
-- (TheSportsDB has none on file). Badges are TheSportsDB's, hotlinked, the
-- same internal-use-only arrangement as the Currie Cup. Fixtures and results
-- arrive through the ingest (raw.request_event_ids / raw.request_live).

insert into public.competitions (id, name, short_name) values
  ('4446', 'United Rugby Championship', 'URC')
on conflict (id) do nothing;

insert into public.seasons (id, name, is_replay, competition_id, feed_season, starts_on) values
  ('urc-2026-27', 'URC 2026-27', false, '4446', '2026-2027', '2026-09-25')
on conflict (id) do nothing;

insert into public.teams as t (id, name, display_name, short_name, stadium, colour, colour_ink, badge_url, source) values
  ('135595', 'Benetton',      'Benetton',  'BEN', 'Stadio di Monigo',          '#0b6b3a', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/txsuxw1453647910.png', 'thesportsdb'),
  ('136666', 'Bulls',         'Bulls',     'BUL', 'Loftus Versfeld',           '#1c3f94', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/7dtgtv1649010361.png', 'thesportsdb'),
  ('135596', 'Cardiff Rugby', 'Cardiff',   'CAR', 'Cardiff Arms Park',         '#6fa8dc', '#0d1b2a', 'https://r2.thesportsdb.com/images/media/team/badge/p8728b1647091605.png', 'thesportsdb'),
  ('135597', 'Connacht',      'Connacht',  'CON', 'Dexcom Stadium',            '#00843d', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/4ziybw1647168615.png', 'thesportsdb'),
  ('135602', 'Dragons',       'Dragons',   'DRA', 'Rodney Parade',             '#c8102e', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/d1fk1n1663329343.png', 'thesportsdb'),
  ('135598', 'Edinburgh',     'Edinburgh', 'EDI', 'Hive Stadium',              '#8a1538', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/5t1tbn1536391225.png', 'thesportsdb'),
  ('135600', 'Glasgow',       'Glasgow',   'GLA', 'Scotstoun Stadium',         '#1b2a5c', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/0kki0e1578143411.png', 'thesportsdb'),
  ('135599', 'Leinster',      'Leinster',  'LEI', 'Aviva Stadium',             '#005bac', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/qtff3q1716739427.png', 'thesportsdb'),
  ('136668', 'Lions',         'Lions',     'LIO', 'Ellis Park',                '#d2232a', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/6y804o1649010370.png', 'thesportsdb'),
  ('135601', 'Munster',       'Munster',   'MUN', 'Thomond Park',              '#b3001b', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/s3d28t1716493148.png', 'thesportsdb'),
  ('135603', 'Ospreys',       'Ospreys',   'OSP', 'Swansea.com Stadium',       '#161616', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/zctq2h1552074123.png', 'thesportsdb'),
  ('135604', 'Scarlets',      'Scarlets',  'SCA', 'Parc y Scarlets',           '#a6192e', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/vtxpxp1453652163.png', 'thesportsdb'),
  ('136670', 'Stormers',      'Stormers',  'STO', 'DHL Stadium',               '#1f6fb8', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/d1v82u1757674073.png', 'thesportsdb'),
  ('136669', 'The Sharks',    'Sharks',    'SHA', 'Hollywoodbets Kings Park',  '#1a1a1a', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/r1f6sk1716742644.png', 'thesportsdb'),
  ('135605', 'Ulster',        'Ulster',    'ULS', 'Affidea Stadium',           '#f4f4f4', '#b0122a', 'https://r2.thesportsdb.com/images/media/team/badge/j8usvw1716743144.png', 'thesportsdb'),
  ('135606', 'Zebre',         'Zebre',     'ZEB', 'Stadio Sergio Lanfranchi',  '#2b2b2b', '#ffffff', 'https://r2.thesportsdb.com/images/media/team/badge/y0vaog1716739157.png', 'thesportsdb')
on conflict (id) do update set display_name = excluded.display_name, short_name = excluded.short_name,
  stadium = excluded.stadium, colour = excluded.colour, colour_ink = excluded.colour_ink, badge_url = excluded.badge_url;

-- The same group, ready for the URC.
insert into public.pools (season, name, created_by)
select 'urc-2026-27', 'The Originals', (select user_id from public.members order by is_admin desc, joined_at limit 1)
where exists (select 1 from public.members)
  and not exists (select 1 from public.pools where season = 'urc-2026-27');
insert into public.pool_members (pool_id, user_id)
select p.id, m.user_id from public.pools p cross join public.members m
where p.season = 'urc-2026-27'
on conflict do nothing;
