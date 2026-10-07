-- Read state follows the phone (a message read there clears the conversation here) and
-- conversations can be archived, as in the WhatsApp app.
alter table public.whatsapp_conversations add column if not exists archived boolean not null default false;

-- Server: a received message was read on another device (phone, WhatsApp Web): its conversation is read.
create function public.mark_whatsapp_read_by_message(p_agency_id uuid, p_external_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.whatsapp_conversations c set unread_count = 0
    from public.whatsapp_messages m
    where m.agency_id = p_agency_id and m.external_id = p_external_id and m.direction = 'in'
      and c.id = m.conversation_id and c.unread_count > 0;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Team members with access: archive or unarchive a conversation.
create function public.set_whatsapp_conversation_archived(p_conversation_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_conversations c set archived = coalesce(p_archived, false)
    where c.id = p_conversation_id and private.can_open_whatsapp(c.agency_id);
end $$;

-- A new message in an archived private conversation brings it back, like WhatsApp.
create function private.whatsapp_unarchive_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'in' then
    update public.whatsapp_conversations set archived = false where id = new.conversation_id and archived and not is_group;
  end if;
  return new;
end $$;
create trigger whatsapp_messages_unarchive after insert on public.whatsapp_messages
  for each row execute function private.whatsapp_unarchive_on_message();

revoke all on function public.mark_whatsapp_read_by_message(uuid, text), public.set_whatsapp_conversation_archived(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_whatsapp_read_by_message(uuid, text) to service_role;
grant execute on function public.set_whatsapp_conversation_archived(uuid, boolean) to authenticated;
