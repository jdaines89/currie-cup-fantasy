# School lists

`schools_<province>.json` are the EMIS school lists (2025), cleaned. The
other eight provinces (FS, GP, KZN, LP, MP, NC, NW, WC) come from the DBE's
national list for Quarter 3 of 2025 via `load_national.py`, cleaned the same way.

`schools_ec.json` is the Eastern Cape's EMIS school list (2025), cleaned:
coordinates fixed (the source swaps latitude and longitude), town names made
consistent, early-childhood centres dropped, and every contact detail
(principal, phone, address) left out. `load_schools.py` builds it from the
cleaned CSV.

Load or refresh it in the database (SQL editor, as an admin). The first
statement asks for the file; run the second a few seconds later.

```sql
select net.http_get('https://raw.githubusercontent.com/jdaines89/scrumline/main/supabase/data/schools_ec.json');
-- or schools_fs.json, schools_gp.json, schools_kzn.json, ... one province at a time

insert into public.schools
select * from json_populate_recordset(null::public.schools,
  (select content::json from net._http_response where status_code = 200 order by created desc limit 1))
on conflict (emis) do update set
  name = excluded.name, town = excluded.town, district = excluded.district, no_fee = excluded.no_fee,
  quintile = excluded.quintile, offers_primary = excluded.offers_primary, offers_matric = excluded.offers_matric,
  lat = excluded.lat, lon = excluded.lon, learners = excluded.learners, source = excluded.source;
```
