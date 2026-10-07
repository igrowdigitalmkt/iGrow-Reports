-- Media of inbox messages is fetched from WhatsApp only when someone opens it (files are not
-- copied). Official numbers need the media id sent in the webhook; the QR Code session finds the
-- file by the message id.
alter table public.whatsapp_messages add column if not exists media_id text check (char_length(media_id) <= 200);

drop function public.record_whatsapp_message(uuid, uuid, text, boolean, text, text, text, text, text, text, text, text, text, timestamptz);

create function public.record_whatsapp_message(
  p_agency_id uuid, p_connection_id uuid, p_remote_id text, p_is_group boolean, p_title text,
  p_external_id text, p_direction text, p_kind text, p_body text, p_media_name text, p_media_mime text,
  p_author text, p_status text, p_sent_at timestamptz, p_media_id text default null)
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
      title = coalesce(public.whatsapp_conversations.title, excluded.title),
      client_id = coalesce(public.whatsapp_conversations.client_id, excluded.client_id),
      updated_at = now()
    returning * into v_conversation;

  insert into public.whatsapp_messages(agency_id, conversation_id, external_id, direction, kind, body, media_name, media_mime, media_id, author, status, sent_at)
    values (p_agency_id, v_conversation.id, left(p_external_id, 200), p_direction, p_kind, left(p_body, 8000), left(p_media_name, 255),
      left(p_media_mime, 120), left(p_media_id, 200), left(p_author, 200), p_status, p_sent_at)
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

revoke all on function public.record_whatsapp_message(uuid, uuid, text, boolean, text, text, text, text, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_whatsapp_message(uuid, uuid, text, boolean, text, text, text, text, text, text, text, text, text, timestamptz, text) to service_role;
