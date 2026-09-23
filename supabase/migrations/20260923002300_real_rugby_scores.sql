-- Only scores a rugby side can actually post. Points come in 3s (penalty,
-- drop goal), 5s (try), 7s (converted try) and 2s (a conversion, only after
-- a try), so every total is reachable except 1, 2 and 4. Nobody scores 100
-- in this company, so two digits is plenty.
--
-- NOT VALID: calls already made keep standing (one 1-1 was on file when this
-- landed); every new or changed call must pass.
create or replace function public.is_rugby_score(n int)
returns boolean
language sql immutable
as $$ select n between 0 and 99 and n not in (1, 2, 4) $$;

alter table public.predictions
  add constraint predictions_real_score
  check (public.is_rugby_score(home_score) and public.is_rugby_score(away_score)) not valid;
