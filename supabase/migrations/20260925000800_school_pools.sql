-- School pools: save your school and you're in its pool, for every tournament.
--
-- A school pool is an ordinary pool (leaderboard + chat) tied to one school
-- and stage. Membership follows public.member_schools: save a school and you
-- join its pools; change or remove it and you leave them. Nobody joins one
-- by code or leaves one by hand, so a school pool is exactly the people who
-- say they went there.

alter table public.pools
  add column school_emis text references public.schools(emis),
  add column school_stage text check (school_stage in ('primary', 'high')),
  add constraint pools_school_both check ((school_emis is null) = (school_stage is null));
create unique index pools_school on public.pools (season, school_emis, school_stage) where school_emis is not null;

-- Brings one member's school pools in line with their saved schools.
create or replace function public.sync_school_pools(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pool_members pm
  using public.pools p
  where pm.pool_id = p.id and pm.user_id = p_user and p.school_emis is not null
    and not exists (select 1 from public.member_schools ms
                    where ms.user_id = p_user and ms.emis = p.school_emis and ms.stage = p.school_stage);

  insert into public.pools (season, name, created_by, school_emis, school_stage)
  select s.id, left(sc.name, 40), p_user, ms.emis, ms.stage
  from public.member_schools ms
  join public.schools sc on sc.emis = ms.emis
  cross join public.seasons s
  where ms.user_id = p_user
  on conflict (season, school_emis, school_stage) where school_emis is not null do nothing;

  insert into public.pool_members (pool_id, user_id)
  select p.id, p_user
  from public.member_schools ms
  join public.pools p on p.school_emis = ms.emis and p.school_stage = ms.stage
  where ms.user_id = p_user
  on conflict do nothing;
end $$;

create or replace function public.member_schools_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_school_pools(coalesce(new.user_id, old.user_id));
  return null;
end $$;
create trigger member_schools_sync after insert or update or delete on public.member_schools
  for each row execute function public.member_schools_sync();

-- A new tournament gets school pools for everyone who has saved a school.
create or replace function public.seasons_school_pools()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_school_pools(u.user_id) from (select distinct user_id from public.member_schools) u;
  return null;
end $$;
create trigger seasons_school_pools after insert on public.seasons
  for each statement execute function public.seasons_school_pools();

revoke execute on function public.sync_school_pools(uuid), public.member_schools_sync(), public.seasons_school_pools()
  from anon, authenticated, public;

-- School pools aren't joined by code or left by hand.
create or replace function public.join_pool(p_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  pid bigint;
begin
  if not public.is_member() then
    raise exception 'Only league members can join pools' using errcode = '42501';
  end if;
  select id into pid from public.pools where join_code = upper(btrim(p_code)) and school_emis is null;
  if pid is null then
    raise exception 'No pool has that code' using errcode = 'P0001';
  end if;
  insert into public.pool_members (pool_id, user_id) values (pid, auth.uid()) on conflict do nothing;
  return pid;
end;
$$;

drop policy "leave a pool" on public.pool_members;
create policy "leave a pool" on public.pool_members for delete to authenticated
  using (user_id = auth.uid()
         and not exists (select 1 from public.pools p where p.id = pool_id and p.school_emis is not null));

-- Only the app makes school pools, and nobody renames them.
drop policy "start a pool" on public.pools;
create policy "start a pool" on public.pools for insert to authenticated
  with check (public.is_member() and created_by = auth.uid() and school_emis is null and school_stage is null);
drop policy "rename your pool" on public.pools;
create policy "rename your pool" on public.pools for update to authenticated
  using (created_by = auth.uid() and school_emis is null) with check (created_by = auth.uid() and school_emis is null);

-- Everyone who has already saved a school.
select public.sync_school_pools(u.user_id) from (select distinct user_id from public.member_schools) u;
