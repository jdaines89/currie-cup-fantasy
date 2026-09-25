-- Newcomers to a pool see its chat from the moment they join, not the
-- conversation that came before (which may have been about them).
--
-- pool_members.history_from is when your view of the pool's chat starts.
-- Everyone already in a pool keeps the history they can see today.

alter table public.pool_members add column history_from timestamptz not null default now();
update public.pool_members set history_from = '-infinity';

create or replace function public.can_read_chat(p_pool bigint, p_at timestamptz)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.pool_members
                 where pool_id = p_pool and user_id = auth.uid() and p_at >= history_from)
$$;
revoke execute on function public.can_read_chat(bigint, timestamptz) from anon, public;
grant execute on function public.can_read_chat(bigint, timestamptz) to authenticated;

drop policy "pool reads" on public.chat_messages;
create policy "pool reads" on public.chat_messages for select to authenticated
  using (public.can_read_chat(pool_id, created_at));
