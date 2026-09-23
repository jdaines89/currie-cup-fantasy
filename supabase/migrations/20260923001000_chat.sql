-- League chat, with @tags.
--
-- A message stores a tag as <@user_id>, not as a name, so a tag still points
-- at the right person after they rename themselves, and the app draws the
-- current name. The trigger reads the tags out into chat_mentions: one row
-- per person tagged, which is what "you were tagged" and any later
-- notification query. Tags naming someone who isn't a member are dropped.
--
-- New messages reach open screens through Supabase Realtime, which applies
-- the same row-level security: only members receive them.

create table public.chat_messages (
  id         bigint generated always as identity primary key,
  author_id  uuid not null default auth.uid() references public.members(user_id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index chat_messages_recent on public.chat_messages (created_at desc);

create table public.chat_mentions (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  user_id    uuid   not null references public.members(user_id) on delete cascade,
  primary key (message_id, user_id)
);
create index chat_mentions_user on public.chat_mentions (user_id, message_id desc);

-- How far each member has read, for the unread badge.
create table public.chat_reads (
  user_id      uuid primary key default auth.uid() references public.members(user_id) on delete cascade,
  last_read_id bigint not null default 0
);

create or replace function public.chat_extract_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_mentions (message_id, user_id)
  select distinct new.id, m.user_id
  from regexp_matches(new.body, '<@([0-9a-f-]{36})>', 'g') as t(x)
  join public.members m on m.user_id::text = t.x[1]
  on conflict do nothing;
  return new;
end;
$$;
create trigger chat_messages_mentions after insert on public.chat_messages
  for each row execute function public.chat_extract_mentions();
revoke execute on function public.chat_extract_mentions() from anon, authenticated, public;

-- Access: members read everything; you write as yourself, delete your own,
-- and nobody edits a message after the fact.
alter table public.chat_messages enable row level security;
alter table public.chat_messages force row level security;
alter table public.chat_mentions enable row level security;
alter table public.chat_mentions force row level security;
alter table public.chat_reads enable row level security;
alter table public.chat_reads force row level security;
revoke all on public.chat_messages, public.chat_mentions, public.chat_reads from anon;

create policy "members read" on public.chat_messages for select to authenticated using (public.is_member());
create policy "post as yourself" on public.chat_messages for insert to authenticated
  with check (public.is_member() and author_id = auth.uid());
create policy "delete your own" on public.chat_messages for delete to authenticated using (author_id = auth.uid());
revoke update on public.chat_messages from authenticated;

create policy "members read" on public.chat_mentions for select to authenticated using (public.is_member());
revoke insert, update, delete on public.chat_mentions from authenticated;

create policy "own read marker" on public.chat_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

-- Live updates. The publication only exists on Supabase itself.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
