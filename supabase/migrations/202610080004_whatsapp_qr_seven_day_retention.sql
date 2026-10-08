-- QR Code is a 7-day support window; Cloud API history is not affected.
create or replace function public.prune_whatsapp_qr_messages(p_batch_size integer default 200)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_messages integer := 0; v_chats integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if p_batch_size < 1 or p_batch_size > 250 then
    raise exception 'Lote excede o limite.' using errcode = '22023';
  end if;
  with victims as (
    select m.id from public.whatsapp_messages m
    join public.whatsapp_conversations c on c.id=m.conversation_id
    where c.channel='qr' and m.sent_at < now()-interval '7 days'
    order by m.sent_at,m.id limit p_batch_size
    for update of m skip locked
  )
  delete from public.whatsapp_messages m using victims v where m.id=v.id;
  get diagnostics v_messages = row_count;
  if v_messages < p_batch_size then
    with victims as (
      select c.id from public.whatsapp_conversations c
      where c.channel='qr'
        and (c.last_message_at is null or c.last_message_at < now()-interval '7 days')
        and not exists (select 1 from public.whatsapp_messages m
          where m.conversation_id=c.id and m.sent_at >= now()-interval '7 days')
      order by c.last_message_at asc nulls first,c.id
      limit least(10,p_batch_size-v_messages)
      for update of c skip locked
    )
    delete from public.whatsapp_conversations c using victims v where c.id=v.id;
    get diagnostics v_chats = row_count;
  end if;
  return v_messages+v_chats;
end $$;
revoke all on function public.prune_whatsapp_qr_messages(integer) from public,anon,authenticated;
grant execute on function public.prune_whatsapp_qr_messages(integer) to service_role;