-- The QR Code server does not keep messages, so a file is found by its WhatsApp reference
-- (encrypted location and key, no content). Only the server writes it.
alter table public.whatsapp_messages add column if not exists media_ref jsonb
  check (media_ref is null or (jsonb_typeof(media_ref) = 'object' and pg_column_size(media_ref) <= 8000));

create function public.set_whatsapp_message_media_ref(p_agency_id uuid, p_external_id text, p_media_ref jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.whatsapp_messages set media_ref = p_media_ref
    where agency_id = p_agency_id and external_id = p_external_id and media_ref is null;
end $$;
revoke all on function public.set_whatsapp_message_media_ref(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_whatsapp_message_media_ref(uuid, text, jsonb) to service_role;
