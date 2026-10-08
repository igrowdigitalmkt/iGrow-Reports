-- Starred messages are a private iGrow bookmark for each team member.
-- They are not WhatsApp device stars and disappear when QR history is cleared.
create table public.whatsapp_message_stars (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.whatsapp_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agency_id,user_id,message_id)
);
create index whatsapp_message_stars_recent on public.whatsapp_message_stars(agency_id,user_id,created_at desc);
alter table public.whatsapp_message_stars enable row level security;
revoke all on public.whatsapp_message_stars from public,anon,authenticated;
grant select,insert,delete on public.whatsapp_message_stars to authenticated;
grant all on public.whatsapp_message_stars to service_role;
create policy whatsapp_message_stars_select on public.whatsapp_message_stars for select to authenticated
  using (user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id));
create policy whatsapp_message_stars_insert on public.whatsapp_message_stars for insert to authenticated
  with check (user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id)
    and exists (select 1 from public.whatsapp_messages m
      where m.id=message_id and m.agency_id=agency_id));
create policy whatsapp_message_stars_delete on public.whatsapp_message_stars for delete to authenticated
  using (user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id));
