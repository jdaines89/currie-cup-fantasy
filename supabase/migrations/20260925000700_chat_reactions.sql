-- Emoji reactions on chat messages. A short fixed set, one of each per
-- person per message. You see and add reactions only on messages you can
-- read (your pools), and remove only your own.

create table public.chat_reactions (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '😂', '🔥', '😮', '😢', '🏉')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.chat_reactions enable row level security;
alter table public.chat_reactions force row level security;
revoke all on public.chat_reactions from anon;
revoke insert, update, delete on public.chat_reactions from authenticated;
grant insert (message_id, user_id, emoji) on public.chat_reactions to authenticated;
grant delete on public.chat_reactions to authenticated;

-- The subquery runs under the reader's own chat_messages policy, so a
-- reaction is visible exactly where its message is.
create policy "read reactions on messages you can read" on public.chat_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages c where c.id = message_id));
create policy "react as yourself" on public.chat_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.chat_messages c where c.id = message_id));
create policy "remove your own reaction" on public.chat_reactions for delete to authenticated
  using (user_id = auth.uid());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
end $$;
