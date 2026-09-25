-- Schools, and the schools each member went to.
--
-- public.schools is the government's list (EMIS), keyed by the EMIS number,
-- which is permanent and unique even where names repeat. It is reference
-- data: members read it, only an admin load changes it. Contact details from
-- the source list are never stored.
--
-- public.member_schools holds at most one primary and one high school per
-- member, with the year they left (matric year for high school). Everyone in
-- the league can see everyone's schools, so a claim is made in front of
-- people who know you. A choice can be changed or removed for 14 days after
-- it is first saved, to fix mistakes; after that it is fixed and only an
-- admin can change it, so nobody hops to a stronger school mid-season.

create table public.schools (
  emis           text primary key check (emis ~ '^[0-9]{6,12}$'),
  name           text not null,
  town           text,
  province       text not null,
  district       text,
  no_fee         boolean not null,
  quintile       smallint check (quintile between 1 and 5),
  offers_primary boolean not null,
  offers_matric  boolean not null,
  lat            double precision,
  lon            double precision,
  learners       integer,
  source         text not null
);
create index schools_name on public.schools (lower(name));

create table public.member_schools (
  user_id        uuid not null references public.members(user_id) on delete cascade,
  stage          text not null check (stage in ('primary', 'high')),
  emis           text not null references public.schools(emis),
  last_year      smallint check (last_year between 1940 and 2045),
  first_saved_at timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, stage)
);
create index member_schools_emis on public.member_schools (emis, stage, last_year);

-- A primary school must teach primary grades and a high school must go to matric.
-- Members can change a choice only in its first 14 days; admin loads (no signed-in user) can always.
create or replace function public.check_member_school()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.schools s where s.emis = new.emis
                 and case new.stage when 'primary' then s.offers_primary else s.offers_matric end) then
    raise exception 'That school has no % phase', new.stage using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if old.first_saved_at < now() - interval '14 days' then
        raise exception 'Your % school is fixed now. Ask an admin to change it.', old.stage using errcode = 'insufficient_privilege';
      end if;
      new.first_saved_at := old.first_saved_at;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger member_school_rules before insert or update on public.member_schools
  for each row execute function public.check_member_school();

alter table public.schools enable row level security;
alter table public.schools force row level security;
alter table public.member_schools enable row level security;
alter table public.member_schools force row level security;
revoke all on public.schools, public.member_schools from anon;
revoke insert, update, delete on public.schools from authenticated;
revoke insert, update, delete on public.member_schools from authenticated;
grant insert (user_id, stage, emis, last_year) on public.member_schools to authenticated;
grant update (emis, last_year) on public.member_schools to authenticated;
grant delete on public.member_schools to authenticated;

create policy "members read" on public.schools for select to authenticated using (public.is_member());
create policy "members read" on public.member_schools for select to authenticated using (public.is_member());
create policy "own schools in" on public.member_schools for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
create policy "own schools change" on public.member_schools for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own schools out while open" on public.member_schools for delete to authenticated
  using (user_id = auth.uid() and first_saved_at > now() - interval '14 days');
