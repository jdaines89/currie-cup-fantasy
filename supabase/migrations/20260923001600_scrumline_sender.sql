-- The app is Scrumline now: reminder emails come from that name.
update notify.settings set value = 'Scrumline' where key = 'sender_name';
