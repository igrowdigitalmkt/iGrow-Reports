-- Bounded retention for QR Code conversations: the WhatsApp inbox is for recent replies,
-- not a complete message archive. Cloud API (official) messages remain untouched.
-- Never delete unread or favorited conversations; keep metadata for archive/unread sync.
-- The operation is intentionally one small batch per call, with SKIP LOCKED.
create or replace function public.prune_whatsapp_qr_messages(p_batch_size integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if p_batch_size < 1 or p_batch_size > 250 then
    raise exception 'Lote excede o limite de segurança.' using errcode = '22023';
  end if;

  with victims as (
    select m.id
    from public.whatsapp_messages m
    join public.whatsapp_conversations c on c.id = m.conversation_id
    where c.channel = 'qr'
      and c.unread_count = 0
      and not c.favorite
      and m.sent_at < now() - interval '60 days'
    order by m.sent_at asc, m.id
    limit p_batch_size
    for update of m skip locked
  )
  delete from public.whatsapp_messages m
  using victims v where m.id = v.id;

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;
revoke all on function public.prune_whatsapp_qr_messages(integer) from public, anon, authenticated;
grant execute on function public.prune_whatsapp_qr_messages(integer) to service_role;
