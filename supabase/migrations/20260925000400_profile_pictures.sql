-- Profile pictures: one small square photo per member, shown in chat.
--
-- The photo is cropped and shrunk on the phone (256 x 256 JPEG) before it is
-- uploaded, so the bucket only ever holds small files. The bucket is private:
-- like everything else in the league, only signed-in members can see a
-- picture, through a short-lived signed link. Each member writes only inside
-- their own folder (<user_id>/...), and members.avatar_path can only point
-- there.

alter table public.members add column avatar_path text;
alter table public.members add constraint members_avatar_path_own
  check (avatar_path is null or avatar_path ~ ('^' || user_id::text || '/[A-Za-z0-9_-]{1,64}\.jpg$'));
grant update (avatar_path) on public.members to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 262144, array['image/jpeg'])
on conflict (id) do nothing;

create policy "members see pictures" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_member());

create policy "members add their own picture" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_member()
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "members remove their own picture" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
