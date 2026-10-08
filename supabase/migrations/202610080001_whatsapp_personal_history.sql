-- Historical QR messages: import personal conversations, never group history.
-- Use the normal deduplicating insert, but preserve the phone's authoritative unread counter.
-- The wrapper runs atomically so temporary unread increments are never externally committed.

create or replace function public.record_whatsapp_history_message(
  p_agency_id uuid, p_connection_id uuid, p_remote_id text, p_is_group boolean,
  p_title text, p_external_id text, p_direction text, p_kind text, p_body text,
  p_media_name text, p_media_mime text, p_author text, p_status text,
  p_sent_at timestamptz, p_media_id text default null
)
returns table(conversation_id uuid, inserted boolean, needs_title boolean)
language plpgsql security definer set search_path = '' as $$
declare v_result record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if p_connection_id is not null or p_is_group
    or right(coalesce(p_remote_id, ''), 5) = '@g.us'
    or right(coalesce(p_remote_id, ''), 10) = '@broadcast' then
    return;
  end if;

  select * into v_result from public.record_whatsapp_message(
    p_agency_id, p_connection_id, p_remote_id, false,
    p_title, p_external_id, p_direction, p_kind, p_body,
    p_media_name, p_media_mime, p_author, p_status, p_sent_at, p_media_id
  );
  if not found then return; end if;

  if v_result.inserted and p_direction = 'in' then
    update public.whatsapp_conversations
       set unread_count = greatest(0, unread_count - 1)
     where id = v_result.conversation_id and agency_id = p_agency_id;
  end if;

  return query select v_result.conversation_id::uuid, v_result.inserted::boolean, v_result.needs_title::boolean;
end $$;

revoke all on function public.record_whatsapp_history_message(
 uuid, uuid, text, boolean, text, text, text, text, text,
 text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_whatsapp_history_message(
 uuid, uuid, text, boolean, text, text, text, text, text,
 text, text, text, text, timestamptz, text
) to service_role;

-- Indexed incremental inbox polling avoids scanning all conversations every 5 seconds.
create index if not exists whatsapp_conversations_agency_updated_idx
on public.whatsapp_conversations (agency_id, updated_at, id);
