-- WhatsApp inbox: conversations and messages of the workspace's numbers (QR Code session and
-- official numbers), recorded from the moment this is installed. Only the server writes; team
-- members read when they can open the WhatsApp area (Equipe › Permissões).

alter table public.agency_member_permissions drop constraint agency_member_permissions_modules_check;
alter table public.agency_member_permissions add constraint agency_member_permissions_modules_check
  check (modules <@ array['visao_geral','clientes','relatorios','agendamentos','integracoes','whatsapp']::text[]);

create function private.can_open_whatsapp(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agency_users au
    where au.agency_id = p_agency_id and au.user_id = auth.uid()
      and (au.role in ('owner','admin')
        or not exists (select 1 from public.agency_member_permissions p where p.agency_id = au.agency_id and p.user_id = au.user_id)
        or exists (select 1 from public.agency_member_permissions p where p.agency_id = au.agency_id and p.user_id = au.user_id and 'whatsapp' = any(p.modules)))
  );
$$;
revoke all on function private.can_open_whatsapp(uuid) from public, anon;
grant execute on function private.can_open_whatsapp(uuid) to authenticated, service_role;

-- Brazilian mobile numbers may arrive with or without the ninth digit: compare by DDD + last 8.
create function private.whatsapp_phone_key(p_digits text)
returns text language sql immutable set search_path = '' as $$
  select case when p_digits ~ '^55[0-9]{10,11}$' then substr(p_digits, 1, 4) || right(p_digits, 8) else p_digits end;
$$;

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  channel text not null check (channel in ('qr','official')),
  whatsapp_connection_id uuid references public.whatsapp_connections(id) on delete cascade,
  -- 'qr' or the official number id: one inbox per number.
  channel_key text not null check (char_length(channel_key) between 2 and 64),
  -- Phone digits with country code, or the group id.
  remote_id text not null check (char_length(remote_id) between 3 and 120),
  is_group boolean not null default false,
  title text check (char_length(title) <= 200),
  client_id uuid references public.clients(id) on delete set null,
  favorite boolean not null default false,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text check (char_length(last_message_preview) <= 300),
  last_message_direction text check (last_message_direction in ('in','out')),
  last_message_kind text check (char_length(last_message_kind) <= 20),
  last_message_status text check (last_message_status in ('pending','sent','delivered','read','failed')),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, channel_key, remote_id),
  check ((channel = 'qr') = (whatsapp_connection_id is null))
);
create index whatsapp_conversations_list_idx on public.whatsapp_conversations(agency_id, channel_key, last_message_at desc nulls last);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 200),
  direction text not null check (direction in ('in','out')),
  kind text not null default 'text'
    check (kind in ('text','image','video','audio','document','sticker','location','contact','reaction','template','other')),
  body text check (char_length(body) <= 8000),
  media_name text check (char_length(media_name) <= 255),
  media_mime text check (char_length(media_mime) <= 120),
  author text check (char_length(author) <= 200),
  status text check (status in ('pending','sent','delivered','read','failed')),
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);
create index whatsapp_messages_thread_idx on public.whatsapp_messages(conversation_id, sent_at desc);
create index whatsapp_messages_external_idx on public.whatsapp_messages(external_id);

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_conversations, public.whatsapp_messages from public, anon, authenticated;
grant select on public.whatsapp_conversations, public.whatsapp_messages to authenticated;
grant all on public.whatsapp_conversations, public.whatsapp_messages to service_role;
create policy whatsapp_conversations_read on public.whatsapp_conversations for select to authenticated
  using (private.can_open_whatsapp(agency_id));
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated
  using (private.can_open_whatsapp(agency_id));

-- Records one message (idempotent by external id) and keeps the conversation summary current.
-- Returns the conversation, whether the message is new and whether the title is still unknown.
create function public.record_whatsapp_message(
  p_agency_id uuid, p_connection_id uuid, p_remote_id text, p_is_group boolean, p_title text,
  p_external_id text, p_direction text, p_kind text, p_body text, p_media_name text, p_media_mime text,
  p_author text, p_status text, p_sent_at timestamptz)
returns table(conversation_id uuid, inserted boolean, needs_title boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := coalesce(p_connection_id::text, 'qr');
  v_conversation public.whatsapp_conversations;
  v_client uuid;
  v_inserted boolean := false;
  v_preview text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not p_is_group then
    select r.client_id into v_client from public.client_recipients r
      where r.agency_id = p_agency_id and private.whatsapp_phone_key(regexp_replace(r.phone, '\D', '', 'g')) = private.whatsapp_phone_key(p_remote_id)
      order by r.active desc, r.created_at limit 1;
  end if;
  insert into public.whatsapp_conversations(agency_id, channel, whatsapp_connection_id, channel_key, remote_id, is_group, title, client_id)
    values (p_agency_id, case when p_connection_id is null then 'qr' else 'official' end, p_connection_id, v_key, p_remote_id, p_is_group,
      nullif(left(btrim(coalesce(p_title, '')), 200), ''), v_client)
    on conflict (agency_id, channel_key, remote_id) do update set
      -- Contact names only fill an empty title (a group subject or saved name is kept).
      title = coalesce(public.whatsapp_conversations.title, excluded.title),
      client_id = coalesce(public.whatsapp_conversations.client_id, excluded.client_id),
      updated_at = now()
    returning * into v_conversation;

  insert into public.whatsapp_messages(agency_id, conversation_id, external_id, direction, kind, body, media_name, media_mime, author, status, sent_at)
    values (p_agency_id, v_conversation.id, left(p_external_id, 200), p_direction, p_kind, left(p_body, 8000), left(p_media_name, 255),
      left(p_media_mime, 120), left(p_author, 200), p_status, p_sent_at)
    on conflict on constraint whatsapp_messages_conversation_id_external_id_key do nothing;
  v_inserted := found;

  if v_inserted then
    v_preview := left(coalesce(nullif(btrim(p_body), ''), p_media_name, ''), 300);
    update public.whatsapp_conversations c set
      unread_count = c.unread_count + case when p_direction = 'in' then 1 else 0 end,
      last_inbound_at = case when p_direction = 'in' then greatest(coalesce(c.last_inbound_at, p_sent_at), p_sent_at) else c.last_inbound_at end,
      last_message_at = case when c.last_message_at is null or p_sent_at >= c.last_message_at then p_sent_at else c.last_message_at end,
      last_message_preview = case when c.last_message_at is null or p_sent_at >= c.last_message_at then v_preview else c.last_message_preview end,
      last_message_direction = case when c.last_message_at is null or p_sent_at >= c.last_message_at then p_direction else c.last_message_direction end,
      last_message_kind = case when c.last_message_at is null or p_sent_at >= c.last_message_at then p_kind else c.last_message_kind end,
      last_message_status = case when c.last_message_at is null or p_sent_at >= c.last_message_at then p_status else c.last_message_status end,
      updated_at = now()
    where c.id = v_conversation.id;
  end if;
  return query select v_conversation.id, v_inserted, v_conversation.title is null;
end $$;

-- Delivery/read updates never move backwards; a failure is always recorded.
create function public.update_whatsapp_message_status(p_agency_id uuid, p_external_id text, p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_status not in ('sent','delivered','read','failed') then return 0; end if;
  update public.whatsapp_messages m set status = p_status
    where m.external_id = p_external_id and m.direction = 'out' and (p_agency_id is null or m.agency_id = p_agency_id)
      and (p_status = 'failed' or coalesce(case m.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end, 0)
        < case p_status when 'sent' then 1 when 'delivered' then 2 else 3 end);
  get diagnostics v_count = row_count;
  -- The conversation list shows the ticks of its last message.
  update public.whatsapp_conversations c set last_message_status = m.status
    from public.whatsapp_messages m
    where m.external_id = p_external_id and m.conversation_id = c.id and c.last_message_direction = 'out' and c.last_message_at = m.sent_at;
  return v_count;
end $$;

create function public.set_whatsapp_conversation_title(p_conversation_id uuid, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.whatsapp_conversations set title = nullif(left(btrim(coalesce(p_title, '')), 200), ''), updated_at = now() where id = p_conversation_id;
end $$;

-- Team members with access: mark a conversation as read, or favorite it.
create function public.mark_whatsapp_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_conversations c set unread_count = 0
    where c.id = p_conversation_id and private.can_open_whatsapp(c.agency_id) and c.unread_count > 0;
end $$;

create function public.set_whatsapp_conversation_favorite(p_conversation_id uuid, p_favorite boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_conversations c set favorite = coalesce(p_favorite, false)
    where c.id = p_conversation_id and private.can_open_whatsapp(c.agency_id);
end $$;

revoke all on function public.record_whatsapp_message(uuid, uuid, text, boolean, text, text, text, text, text, text, text, text, text, timestamptz),
  public.update_whatsapp_message_status(uuid, text, text), public.set_whatsapp_conversation_title(uuid, text),
  public.mark_whatsapp_conversation_read(uuid), public.set_whatsapp_conversation_favorite(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_whatsapp_message(uuid, uuid, text, boolean, text, text, text, text, text, text, text, text, text, timestamptz),
  public.update_whatsapp_message_status(uuid, text, text), public.set_whatsapp_conversation_title(uuid, text) to service_role;
grant execute on function public.mark_whatsapp_conversation_read(uuid), public.set_whatsapp_conversation_favorite(uuid, boolean) to authenticated;
