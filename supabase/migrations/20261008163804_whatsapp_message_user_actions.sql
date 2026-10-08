-- Personal organization of recent WhatsApp messages inside iGrow.
-- Pins and "delete for me" never mutate the WhatsApp phone or another member's view.
create table public.whatsapp_message_user_actions (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.whatsapp_messages(id) on delete cascade,
  pinned_at timestamptz,
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (agency_id,user_id,message_id)
);
create index whatsapp_message_user_actions_pins on public.whatsapp_message_user_actions(agency_id,user_id,pinned_at desc) where pinned_at is not null;
alter table public.whatsapp_message_user_actions enable row level security;
revoke all on public.whatsapp_message_user_actions from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_message_user_actions to authenticated;
grant all on public.whatsapp_message_user_actions to service_role;
create policy whatsapp_message_user_actions_read on public.whatsapp_message_user_actions for select to authenticated
 using (user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id));
create policy whatsapp_message_user_actions_insert on public.whatsapp_message_user_actions for insert to authenticated
 with check (
   user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id)
   and exists(select 1 from public.whatsapp_messages m where m.id=message_id and m.agency_id=agency_id)
 );
create policy whatsapp_message_user_actions_update on public.whatsapp_message_user_actions for update to authenticated
 using (user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id))
 with check (
   user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id)
   and exists(select 1 from public.whatsapp_messages m where m.id=message_id and m.agency_id=agency_id)
 );
create policy whatsapp_message_user_actions_delete on public.whatsapp_message_user_actions for delete to authenticated
 using (user_id=(select auth.uid()) and private.can_open_whatsapp(agency_id));
