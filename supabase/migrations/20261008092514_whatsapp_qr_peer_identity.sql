-- WhatsApp may identify the same private peer by PN or by LID.
-- Consolidate only a cryptographically established Baileys PN/LID pair;
-- never infer identity from a matching avatar, contact name, or timestamps.
create table public.whatsapp_qr_peer_links (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  lid text not null check (lid ~ '^[0-9]{8,20}@lid$'),
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  session_epoch timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (agency_id,lid)
);
create index whatsapp_qr_peer_links_phone_idx on public.whatsapp_qr_peer_links(agency_id,phone,session_epoch);
alter table public.whatsapp_qr_peer_links enable row level security;
revoke all on public.whatsapp_qr_peer_links from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_qr_peer_links to service_role;

create or replace function public.bind_whatsapp_qr_peer_links(p_agency_id uuid, p_pairs jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_epoch timestamptz;
  v_pair record;
  v_lid public.whatsapp_conversations;
  v_phone public.whatsapp_conversations;
  v_count integer := 0;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Sem permissao.' using errcode='42501';
  end if;
  if jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) > 30 then return 0; end if;
  select fresh_after into v_epoch from public.whatsapp_qr_reset_guards
    where agency_id=p_agency_id and blocked=false;
  if v_epoch is null then return 0; end if;

  -- Serialize PN/LID merges for a workspace and preserve the QR reset epoch.
  perform pg_advisory_xact_lock(hashtext(p_agency_id::text), 882331);
  for v_pair in
    select distinct on (x.lid) x.lid, split_part(x.phone,'@',1) as phone
    from jsonb_to_recordset(p_pairs) as x(lid text,phone text)
    where x.lid ~ '^[0-9]{8,20}@lid$'
      and x.phone ~ '^[0-9]{8,15}@s[.]whatsapp[.]net$'
    order by x.lid,x.phone
  loop
    -- Refuse contradictory mappings within the *same* QR session.
    if exists(select 1 from public.whatsapp_qr_peer_links
      where agency_id=p_agency_id and lid=v_pair.lid and session_epoch=v_epoch and phone<>v_pair.phone)
    then continue; end if;
    insert into public.whatsapp_qr_peer_links(agency_id,lid,phone,session_epoch)
      values(p_agency_id,v_pair.lid,v_pair.phone,v_epoch)
    on conflict(agency_id,lid) do update set
      phone=excluded.phone,session_epoch=excluded.session_epoch;

    select * into v_lid from public.whatsapp_conversations
      where agency_id=p_agency_id and channel='qr' and remote_id=v_pair.lid for update;
    if found then
      select * into v_phone from public.whatsapp_conversations
        where agency_id=p_agency_id and channel='qr' and remote_id=v_pair.phone for update;
      if not found then
        insert into public.whatsapp_conversations (
          agency_id,channel,whatsapp_connection_id,channel_key,remote_id,is_group,
          title,client_id,favorite,unread_count,archived,
          last_message_at,last_message_preview,last_message_direction,last_message_kind,
          last_message_status,last_inbound_at
        ) values (
          p_agency_id,'qr',null,'qr',v_pair.phone,false,
          v_lid.title,v_lid.client_id,v_lid.favorite,v_lid.unread_count,v_lid.archived,
          v_lid.last_message_at,v_lid.last_message_preview,v_lid.last_message_direction,
          v_lid.last_message_kind,v_lid.last_message_status,v_lid.last_inbound_at
        ) returning * into v_phone;
      else
        update public.whatsapp_conversations set
          title=coalesce(v_phone.title,v_lid.title),
          client_id=coalesce(v_phone.client_id,v_lid.client_id),
          favorite=v_phone.favorite or v_lid.favorite,
          unread_count=greatest(v_phone.unread_count,v_lid.unread_count),
          archived=case when v_phone.updated_at >= v_lid.updated_at then v_phone.archived else v_lid.archived end,
          last_inbound_at=greatest(v_phone.last_inbound_at,v_lid.last_inbound_at),
          last_message_at=greatest(v_phone.last_message_at,v_lid.last_message_at),
          last_message_preview=case when coalesce(v_lid.last_message_at,'-infinity'::timestamptz) > coalesce(v_phone.last_message_at,'-infinity'::timestamptz)
            then v_lid.last_message_preview else v_phone.last_message_preview end,
          last_message_direction=case when coalesce(v_lid.last_message_at,'-infinity'::timestamptz) > coalesce(v_phone.last_message_at,'-infinity'::timestamptz)
            then v_lid.last_message_direction else v_phone.last_message_direction end,
          last_message_kind=case when coalesce(v_lid.last_message_at,'-infinity'::timestamptz) > coalesce(v_phone.last_message_at,'-infinity'::timestamptz)
            then v_lid.last_message_kind else v_phone.last_message_kind end,
          last_message_status=case when coalesce(v_lid.last_message_at,'-infinity'::timestamptz) > coalesce(v_phone.last_message_at,'-infinity'::timestamptz)
            then v_lid.last_message_status else v_phone.last_message_status end,
          updated_at=now()
        where id=v_phone.id;
      end if;
      -- An external message ID is unique per conversation, not per workspace.
      -- Preserve one copy of each message before reparenting and removing the
      -- alias conversation. No message disappears merely because a title matches.
      delete from public.whatsapp_messages old
      where old.conversation_id=v_lid.id and exists(
        select 1 from public.whatsapp_messages kept where kept.conversation_id=v_phone.id
          and kept.external_id=old.external_id);
      update public.whatsapp_messages set conversation_id=v_phone.id where conversation_id=v_lid.id;
      delete from public.whatsapp_conversations where id=v_lid.id;
      v_count := v_count+1;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.bind_whatsapp_qr_peer_links(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bind_whatsapp_qr_peer_links(uuid,jsonb) to service_role;
