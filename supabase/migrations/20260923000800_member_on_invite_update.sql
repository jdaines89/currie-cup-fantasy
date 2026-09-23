-- Supabase's invite creates the auth.users row first and stamps invited_at
-- in a separate update a moment later, so the insert trigger alone saw
-- invited_at null and made no member. Also fire when invited_at is set.

create trigger on_auth_user_invited
  after update of invited_at on auth.users
  for each row
  when (old.invited_at is null and new.invited_at is not null)
  execute function public.handle_new_user();

-- Anyone invited before this fix.
insert into public.members (user_id, email, display_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1))
from auth.users u
where u.invited_at is not null
on conflict (user_id) do nothing;
