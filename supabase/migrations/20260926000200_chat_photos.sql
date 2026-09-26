-- Photos in chat.
--
-- A photo is shrunk on the phone (longest side 1280px, JPEG) before upload,
-- so the bucket only holds small files. The bucket is private: a photo lives
-- in its pool's folder (<pool_id>/<user_id>/<name>.jpg) and only that pool's
-- members can open it, through a short-lived signed link. You add photos only
-- to your own folder in a pool you're in, and a message can only point at a
-- photo in its own pool and its author's folder. A photo can go without words.

alter table public.chat_messages add column image_path text;
alter table public.chat_messages add constraint chat_messages_image_path_own
  check (image_path is null
         or image_path ~ ('^' || pool_id::text || '/' || author_id::text || '/[A-Za-z0-9_-]{1,64}\.jpg$'));
alter table public.chat_messages drop constraint chat_messages_body_check;
alter table public.chat_messages add constraint chat_messages_body_check
  check (length(body) <= 1000 and (image_path is not null or length(btrim(body)) >= 1));
grant insert (image_path) on public.chat_messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- The pool a photo's path belongs to, or null when the path isn't one of ours.
create or replace function public.photo_pool(p_name text)
returns bigint
language sql immutable
set search_path = public
as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9]{1,18}$'
              then ((storage.foldername(p_name))[1])::bigint end
$$;

create policy "pool members see photos" on storage.objects for select to authenticated
  using (bucket_id = 'chat-photos' and public.is_pool_member(public.photo_pool(name)));

create policy "post photos in your pools" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-photos' and public.is_pool_member(public.photo_pool(name))
              and (storage.foldername(name))[2] = auth.uid()::text);

create policy "remove your own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-photos' and (storage.foldername(name))[2] = auth.uid()::text);
