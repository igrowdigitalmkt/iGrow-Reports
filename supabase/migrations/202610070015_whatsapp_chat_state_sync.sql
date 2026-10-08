-- WhatsApp QR chat state comes from the linked phone (Baileys): archive state and unread count.
-- The bridge sends normalized remote ids in batches so one webhook costs one database round trip.

create or replace function public.sync_whatsapp_qr_chat_states(p_agency_id uuid, p_states jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_states, '[]'::jsonb)) <> 'array' then return 0; end if;

  with states as (
    select
      nullif(left(btrim(x.remote_id), 120), '') as remote_id,
      x.archived,
      case when x.unread_count is null then null else greatest(0, least(x.unread_count, 100000)) end as unread_count
    from jsonb_to_recordset(coalesce(p_states, '[]'::jsonb))
      as x(remote_id text, archived boolean, unread_count integer)
  )
  update public.whatsapp_conversations c set
    archived = coalesce(s.archived, c.archived),
    unread_count = coalesce(s.unread_count, c.unread_count),
    updated_at = now()
  from states s
  where c.agency_id = p_agency_id
    and c.channel = 'qr'
    and c.channel_key = 'qr'
    and c.remote_id = s.remote_id
    and s.remote_id is not null
    and (s.archived is not null or s.unread_count is not null)
    and (c.archived is distinct from coalesce(s.archived, c.archived)
      or c.unread_count is distinct from coalesce(s.unread_count, c.unread_count));

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Archive state is now authoritative from the phone. Do not guess that every private inbound
-- message unarchives the chat: WhatsApp can be configured to keep archived chats archived.
drop trigger if exists whatsapp_messages_unarchive on public.whatsapp_messages;

revoke all on function public.sync_whatsapp_qr_chat_states(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_qr_chat_states(uuid, jsonb) to service_role;
