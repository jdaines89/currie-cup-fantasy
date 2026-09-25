-- Schoolmates vouch for each other.
--
-- Anyone can say they went to a school; a school only counts you once two
-- people who say they went there too confirm you. A vouch names the school it
-- was given for, so it lapses by itself if either person later moves to a
-- different school (inside the 14 days a choice stays open).

create table public.school_vouches (
  voucher_id uuid not null references public.members(user_id) on delete cascade,
  member_id  uuid not null references public.members(user_id) on delete cascade,
  stage      text not null check (stage in ('primary', 'high')),
  emis       text not null references public.schools(emis),
  created_at timestamptz not null default now(),
  primary key (voucher_id, member_id, stage),
  check (voucher_id <> member_id)
);
create index school_vouches_member on public.school_vouches (member_id, stage);

-- True when both people have this school saved for this stage right now.
create or replace function public.shares_school(p_a uuid, p_b uuid, p_stage text, p_emis text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select count(*) = 2 from public.member_schools
  where stage = p_stage and emis = p_emis and user_id in (p_a, p_b) and p_a <> p_b
$$;

alter table public.school_vouches enable row level security;
alter table public.school_vouches force row level security;
revoke all on public.school_vouches from anon;
revoke insert, update, delete on public.school_vouches from authenticated;
grant insert (voucher_id, member_id, stage, emis) on public.school_vouches to authenticated;
grant delete on public.school_vouches to authenticated;

create policy "members read" on public.school_vouches for select to authenticated using (public.is_member());
create policy "vouch for a schoolmate" on public.school_vouches for insert to authenticated
  with check (public.is_member() and voucher_id = auth.uid()
              and public.shares_school(voucher_id, member_id, stage, emis));
create policy "take back your vouch" on public.school_vouches for delete to authenticated
  using (voucher_id = auth.uid());

-- Everyone's schools with how many current schoolmates vouch for them.
create view public.school_members with (security_invoker = true) as
select ms.user_id, ms.stage, ms.emis, ms.last_year,
       count(v.voucher_id)::int as vouches,
       count(v.voucher_id) >= 2 as verified
from public.member_schools ms
left join public.school_vouches v
  on v.member_id = ms.user_id and v.stage = ms.stage and v.emis = ms.emis
 and exists (select 1 from public.member_schools vs
             where vs.user_id = v.voucher_id and vs.stage = v.stage and vs.emis = v.emis)
group by ms.user_id, ms.stage, ms.emis, ms.last_year;
revoke all on public.school_members from anon;
grant select on public.school_members to authenticated;
