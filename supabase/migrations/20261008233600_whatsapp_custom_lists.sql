-- Personal custom WhatsApp chat lists; no provider-side WhatsApp list is claimed.
-- Memberships follow conversation IDs and cascade on QR history cleanup.
create table public.whatsapp_custom_lists (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_key text not null,
  name text not null check (char_length(trim(name)) between 1 and 40),
  color text not null default '#00a884' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whatsapp_custom_lists_owner on public.whatsapp_custom_lists (agency_id,user_id,channel_key,sort_order,created_at);
create unique index whatsapp_custom_lists_unique_name on public.whatsapp_custom_lists (agency_id,user_id,channel_key,lower(name));

create table public.whatsapp_custom_list_members (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null references public.whatsapp_custom_lists(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id,conversation_id)
);
create index whatsapp_custom_list_members_chat on public.whatsapp_custom_list_members (conversation_id, list_id);

alter table public.whatsapp_custom_lists enable row level security;
alter table public.whatsapp_custom_list_members enable row level security;
revoke all on public.whatsapp_custom_lists from public,anon,authenticated;
revoke all on public.whatsapp_custom_list_members from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_custom_lists to authenticated;
grant select,insert,delete on public.whatsapp_custom_list_members to authenticated;
grant all on public.whatsapp_custom_lists,public.whatsapp_custom_list_members to service_role;

create policy whatsapp_custom_lists_select on public.whatsapp_custom_lists for select to authenticated
using (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id));
create policy whatsapp_custom_lists_insert on public.whatsapp_custom_lists for insert to authenticated
with check (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id));
create policy whatsapp_custom_lists_update on public.whatsapp_custom_lists for update to authenticated
using (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id))
with check (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id));
create policy whatsapp_custom_lists_delete on public.whatsapp_custom_lists for delete to authenticated
using (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id));

create policy whatsapp_custom_list_members_select on public.whatsapp_custom_list_members for select to authenticated
using (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id)
  and exists (select 1 from public.whatsapp_custom_lists l where l.id = list_id
    and l.agency_id = agency_id and l.user_id = user_id));
create policy whatsapp_custom_list_members_insert on public.whatsapp_custom_list_members for insert to authenticated
with check (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id)
  and exists (select 1 from public.whatsapp_custom_lists l where l.id = list_id
    and l.agency_id = agency_id and l.user_id = user_id
    and exists (select 1 from public.whatsapp_conversations c
      where c.id = conversation_id and c.agency_id = agency_id and c.channel_key = l.channel_key)));
create policy whatsapp_custom_list_members_delete on public.whatsapp_custom_list_members for delete to authenticated
using (user_id = (select auth.uid()) and private.can_open_whatsapp(agency_id)
  and exists (select 1 from public.whatsapp_custom_lists l where l.id = list_id
    and l.agency_id = agency_id and l.user_id = user_id));
